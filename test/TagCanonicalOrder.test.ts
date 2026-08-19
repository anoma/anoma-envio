/**
 * Transaction-wide canonical tag order.
 *
 * `Tag.index` is a position within one action, so it repeats across a transaction.
 * `(actionLogIndex, index)` is the order the protocol adapter adds commitments to its tree,
 * readable from Tag without joining through Resource to Action. The log index comes from the
 * chain, unlike `Action.index`, which counts the order events reach the handler.
 */
import { describe, it, expect } from "vitest";
import { createTestIndexer } from "envio";
import { b32, blob, consumed, created, action, encodeExecute } from "./fixtures/encode-tx.js";

describe("Transaction-wide canonical tag order", () => {
  const CHAIN = 84532;
  const TX_HASH = "0xabababababababababababababababababababababababababababababababababab";
  const CONTRACT: `0x${string}` = "0xcccccccccccccccccccccccccccccccccccccccc";
  const BLOCK = 100;
  const TIMESTAMP = 1700000000;

  // Two actions, each 1 consumed + 1 created, mirroring a real base-sepolia transaction.
  const N0 = b32("n0");
  const C0 = b32("c0");
  const N1 = b32("n1");
  const C1 = b32("c1");
  const VK = b32("vk");
  const ROOT0 = b32("root-0");
  const ROOT1 = b32("root-1");

  const CALLDATA = encodeExecute([
    action([consumed(N0, VK, { resourcePayload: [blob("0xaa")] })], [created(C0, VK)]),
    action([consumed(N1, VK, { resourcePayload: [blob("0xbb")] })], [created(C1, VK)]),
  ]);

  // ActionExecuted for the second action sits at a HIGHER log index than the first.
  const ACTION_0_LOG_INDEX = 5;
  const ACTION_1_LOG_INDEX = 10;

  async function run() {
    const indexer = createTestIndexer();
    const tx = { hash: TX_HASH, input: CALLDATA, value: 0n };
    const actionEvent = (
      root: `0x${string}`,
      n: `0x${string}`,
      c: `0x${string}`,
      logIndex: number
    ) => ({
      contract: "ProtocolAdapter" as const,
      event: "ActionExecuted" as const,
      params: {
        actionTreeRoot: root,
        nullifiers: [n],
        consumedLogicRefs: [VK],
        commitments: [c],
        createdLogicRefs: [VK],
      },
      srcAddress: CONTRACT,
      block: { number: BLOCK, timestamp: TIMESTAMP },
      transaction: tx,
      logIndex,
    });

    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            actionEvent(ROOT0, N0, C0, ACTION_0_LOG_INDEX),
            actionEvent(ROOT1, N1, C1, ACTION_1_LOG_INDEX),
            {
              contract: "ProtocolAdapter",
              event: "TransactionExecuted",
              params: { transactionId: b32("tx-0") },
              srcAddress: CONTRACT,
              block: { number: BLOCK, timestamp: TIMESTAMP },
              transaction: tx,
              logIndex: 15,
            },
          ],
        },
      },
    });
    return indexer;
  }

  it("records each action's own EVM log index", async () => {
    const indexer = await run();
    const actions = [...(await indexer.Action.getAll())].sort((a, b) => a.logIndex - b.logIndex);

    expect(actions).toHaveLength(2);
    expect(actions.map((a) => a.logIndex)).toEqual([ACTION_0_LOG_INDEX, ACTION_1_LOG_INDEX]);
    // logIndex orders the actions the same way the arrival counter does, but is chain-derived.
    expect(actions.map((a) => a.index)).toEqual([0, 1]);
  });

  it("Tag.index alone repeats across actions, so it cannot order the transaction", async () => {
    const indexer = await run();
    const tags = await indexer.Tag.getAll();

    expect(tags).toHaveLength(4);
    const indices = [...tags].map((t) => t.index).sort();
    expect(indices).toEqual([0, 0, 1, 1]);
  });

  it("(actionLogIndex, index) is a total order matching the protocol's tag order", async () => {
    const indexer = await run();
    const tags = [...(await indexer.Tag.getAll())];

    for (const tag of tags) {
      expect(tag.actionLogIndex, `tag ${tag.tagHash} has no actionLogIndex`).toBeDefined();
    }

    const sorted = tags.sort((a, b) => a.actionLogIndex! - b.actionLogIndex! || a.index - b.index);

    // Action 0 contributes its nullifier then its commitment, then action 1 does the same.
    expect(sorted.map((t) => t.tagHash)).toEqual([N0, C0, N1, C1]);

    // The sort key is unique across the transaction, which Tag.index alone is not.
    const keys = sorted.map((t) => `${t.actionLogIndex}:${t.index}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("orders tags independently of the order the tags come back in", async () => {
    const indexer = await run();
    const tags = [...(await indexer.Tag.getAll())];
    const key = (t: (typeof tags)[number]) => `${t.actionLogIndex}:${t.index}`;
    const bySortKey = (a: (typeof tags)[number], b: (typeof tags)[number]) =>
      a.actionLogIndex! - b.actionLogIndex! || a.index - b.index;

    const forward = [...tags].sort(bySortKey).map(key);
    const reversed = [...tags].reverse().sort(bySortKey).map(key);

    expect(reversed).toEqual(forward);
  });
});
