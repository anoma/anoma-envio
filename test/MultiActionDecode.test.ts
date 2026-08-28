/**
 * Multi-action decode correctness.
 *
 * F1: a single execute() with two actions that carry the same tag count. Each ActionExecuted must
 *     map to ITS OWN decoded action (by arrival order), not to the first tag-count match. The old
 *     code assigned both actions' decoded data from decoded.actions[0].
 *
 * Whether a resource's consumed/created side follows tag identity rather than array position is
 * not something this schema can get wrong: ActionExecuted carries the nullifiers and the
 * commitments as separate arrays. The last case below pins that they are read as such.
 */
import { describe, it, expect } from "vitest";
import { createTestIndexer } from "envio";
import { b32, blob, consumed, created, action, encodeExecute } from "./fixtures/encode-tx.js";

describe("Multi-action decode", () => {
  const CHAIN = 84532;
  const TX_HASH = "0xabababababababababababababababababababababababababababababababab";
  // Must be an address indexed for this chain in config.yaml. Envio filters events
  // from any other address before the handler runs.
  const CONTRACT = "0xb5A5a52Af29dA0c8801D9caf4D75a4d6C3895f0A";
  // At or above the chain start_block in config.yaml; Envio filters anything below
  // it before the handler runs, and a simulate item that reaches no handler errors.
  const BLOCK = 45_511_361;
  const TIMESTAMP = 1700000000;

  const N0 = b32("nullifier-0");
  const C0 = b32("commitment-0");
  const N1 = b32("nullifier-1");
  const C1 = b32("commitment-1");

  const VK_N0 = b32("vk-n0");
  const VK_C0 = b32("vk-c0");
  const VK_N1 = b32("vk-n1");
  const VK_C1 = b32("vk-c1");

  const ROOT0 = b32("action-root-0");
  const ROOT1 = b32("action-root-1");

  // Both actions have the same tag count (1 consumed + 1 created) but differ in unit delta and in
  // payload counts, so a mis-mapping between event and calldata is observable.
  const CALLDATA = encodeExecute([
    action(
      [consumed(N0, VK_N0, { resourcePayload: [blob("0xaa")] })],
      [created(C0, VK_C0)],
      ROOT0,
      { x: 1n, y: 2n }
    ),
    action(
      [consumed(N1, VK_N1, { resourcePayload: [blob("0xbb")], discoveryPayload: [blob("0xcc")] })],
      [created(C1, VK_C1)],
      ROOT1,
      { x: 3n, y: 4n }
    ),
  ]);

  const evmTxId = `${CHAIN}_${TX_HASH}`;
  const tx = { hash: TX_HASH, input: CALLDATA, value: 0n };

  const actionEvent = (
    actionTreeRoot: string,
    nullifier: string,
    consumedLogicRef: string,
    commitment: string,
    createdLogicRef: string,
    logIndex: number
  ) =>
    ({
      contract: "ProtocolAdapter",
      event: "ActionExecuted",
      params: {
        actionTreeRoot,
        nullifiers: [nullifier],
        consumedLogicRefs: [consumedLogicRef],
        commitments: [commitment],
        createdLogicRefs: [createdLogicRef],
      },
      srcAddress: CONTRACT,
      block: { number: BLOCK, timestamp: TIMESTAMP },
      transaction: tx,
      logIndex,
    }) as const;

  const ACTION_0 = actionEvent(ROOT0, N0, VK_N0, C0, VK_C0, 5);
  const ACTION_1 = actionEvent(ROOT1, N1, VK_N1, C1, VK_C1, 10);
  const TX_EVENT = {
    contract: "ProtocolAdapter",
    event: "TransactionExecuted",
    params: { transactionId: b32("transaction-0") },
    srcAddress: CONTRACT,
    block: { number: BLOCK, timestamp: TIMESTAMP },
    transaction: tx,
    logIndex: 15,
  } as const;

  async function process(simulate: unknown[]) {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: { [CHAIN]: { simulate } },
    } as Parameters<typeof indexer.process>[0]);
    return indexer;
  }

  const run = () => process([ACTION_0, ACTION_1, TX_EVENT]);

  it("F1: each action carries its OWN decoded unit delta", async () => {
    const indexer = await run();
    const actions = await indexer.Action.getAll();
    expect(actions).toHaveLength(2);

    const action0 = actions.find((a) => a.id === `${evmTxId}_${ROOT0}`);
    const action1 = actions.find((a) => a.id === `${evmTxId}_${ROOT1}`);
    expect(action0, "action 0").toBeDefined();
    expect(action1, "action 1").toBeDefined();

    expect(action0!.unitDeltaX).toBe("1");
    expect(action0!.unitDeltaY).toBe("2");

    // The bug: action 1 would inherit action 0's decoded data.
    expect(action1!.unitDeltaX).toBe("3");
    expect(action1!.unitDeltaY).toBe("4");
  });

  it("F1: each action's resources carry their OWN decoded payload counts", async () => {
    const indexer = await run();
    const resources = await indexer.Resource.getAll();

    const consumed0 = resources.find((r) => r.tagHash === N0);
    const consumed1 = resources.find((r) => r.tagHash === N1);
    expect(consumed0, "consumed resource of action 0").toBeDefined();
    expect(consumed1, "consumed resource of action 1").toBeDefined();

    expect(consumed0!.resourcePayloadCount).toBe(1);
    expect(consumed0!.discoveryPayloadCount).toBe(0);

    expect(consumed1!.resourcePayloadCount).toBe(1);
    expect(consumed1!.discoveryPayloadCount).toBe(1);
  });

  it("reads the consumed and created sides from their own event arrays", async () => {
    const indexer = await run();
    const resources = await indexer.Resource.getAll();
    const tags = await indexer.Tag.getAll();

    expect(resources).toHaveLength(4);

    for (const [tagHash, isConsumed, logicRef] of [
      [N0, true, VK_N0],
      [C0, false, VK_C0],
      [N1, true, VK_N1],
      [C1, false, VK_C1],
    ] as const) {
      const resource = resources.find((r) => r.tagHash === tagHash);
      expect(resource, `resource ${tagHash}`).toBeDefined();
      expect(resource!.isConsumed).toBe(isConsumed);
      expect(resource!.logicRef).toBe(logicRef);

      const tag = tags.find((t) => t.tagHash === tagHash);
      expect(tag, `tag ${tagHash}`).toBeDefined();
      expect(tag!.isConsumed).toBe(isConsumed);
      expect(tag!.logicRef).toBe(logicRef);
    }
  });

  it("indexes a consumed tag before a created one within an action", async () => {
    const indexer = await run();
    const tags = await indexer.Tag.getAll();

    // The canonical tag order is the action tree leaf order: nullifiers, then commitments.
    expect(tags.find((t) => t.tagHash === N0)!.index).toBe(0);
    expect(tags.find((t) => t.tagHash === C0)!.index).toBe(1);
    expect(tags.find((t) => t.tagHash === N1)!.index).toBe(0);
    expect(tags.find((t) => t.tagHash === C1)!.index).toBe(1);
  });

  // The contract emits the actions in calldata order, so position and root always agree. If they
  // ever stopped agreeing, dropping the calldata details beats attaching another action's delta
  // and payload counts, which is what a positional read alone would do.
  it("drops the decoded details when the root at that position disagrees", async () => {
    const indexer = await process([
      { ...ACTION_1, logIndex: 5 },
      { ...ACTION_0, logIndex: 10 },
      TX_EVENT,
    ]);

    const actions = await indexer.Action.getAll();
    expect(actions).toHaveLength(2);
    for (const a of actions) {
      expect(a.unitDeltaX, `action ${a.id}`).toBeUndefined();
      expect(a.unitDeltaY, `action ${a.id}`).toBeUndefined();
    }

    const resources = await indexer.Resource.getAll();
    expect(resources).toHaveLength(4);
    for (const r of resources) {
      expect(r.resourcePayloadCount, `resource ${r.id}`).toBeUndefined();
    }
  });

  it("relinks actions and tags to the Transaction once TransactionExecuted arrives", async () => {
    const indexer = await run();
    const txId = `${evmTxId}_15`;

    const actions = await indexer.Action.getAll();
    for (const a of actions) {
      expect(a.transaction_id, `action ${a.id}`).toBe(txId);
    }

    const tags = await indexer.Tag.getAll();
    for (const t of tags) {
      expect(t.transaction_id, `tag ${t.id}`).toBe(txId);
    }

    const transactions = await indexer.Transaction.getAll();
    expect(transactions).toHaveLength(1);
    expect(transactions[0].transactionId).toBe(b32("transaction-0"));
  });
});
