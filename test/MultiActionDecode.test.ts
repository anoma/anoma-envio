/**
 * Multi-action decode correctness (F1 + F2).
 *
 * F1: a single execute() with two actions that share the same tag count. Each
 *     ActionExecuted must map to ITS OWN decoded action (by arrival order), not to
 *     the first tag-count match. The old code assigned both actions' compliance/logic
 *     data from decoded.actions[0].
 *
 * F2: an action whose logicVerifierInputs are NOT in interleaved consumed/created
 *     order. LogicInput.isConsumed must be derived from tag identity (membership in the
 *     compliance units' nullifier set), not from array position parity.
 */
import { describe, it, expect } from "vitest";
import { createTestIndexer } from "envio";
import { b32, logicInput, complianceInput, action, encodeExecute } from "./fixtures/encode-tx.js";

describe("Multi-action decode (F1 + F2)", () => {
  const CHAIN = 1;
  const TX_HASH = "0xabababababababababababababababababababababababababababababababab";
  // Must be an address indexed for this chain in config.yaml. Envio filters events
  // from any other address before the handler runs.
  const CONTRACT = "0x0eA3B55b68A3f307c8FE3fe66E443247c95F0CfF";
  // At or above the chain start_block in config.yaml; Envio filters anything below
  // it before the handler runs, and a simulate item that reaches no handler errors.
  const BLOCK = 425_772_700;
  const TIMESTAMP = 1700000000;

  // Action 0 — one compliance unit; logic inputs intentionally CREATED-then-CONSUMED
  // (non-interleaved) to exercise F2.
  const N0 = b32("nullifier-0");
  const C0 = b32("commitment-0");
  // Action 1 — one compliance unit; same tag count (2) as action 0 to exercise F1.
  const N1 = b32("nullifier-1");
  const C1 = b32("commitment-1");

  const ROOT0 = b32("action-root-0");
  const ROOT1 = b32("action-root-1");

  const CALLDATA = encodeExecute([
    action(
      [logicInput(C0, b32("vk-c0")), logicInput(N0, b32("vk-n0"))], // non-interleaved
      [complianceInput(N0, C0)]
    ),
    action([logicInput(N1, b32("vk-n1")), logicInput(C1, b32("vk-c1"))], [complianceInput(N1, C1)]),
  ]);

  const evmTxId = `${CHAIN}_${TX_HASH}`;

  async function run() {
    const indexer = createTestIndexer();
    const tx = { hash: TX_HASH, input: CALLDATA, value: 0n };
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            {
              contract: "ProtocolAdapter",
              event: "ActionExecuted",
              params: { actionTreeRoot: ROOT0, actionTagCount: 2n },
              srcAddress: CONTRACT,
              block: { number: BLOCK, timestamp: TIMESTAMP },
              transaction: tx,
              logIndex: 5,
            },
            {
              contract: "ProtocolAdapter",
              event: "ActionExecuted",
              params: { actionTreeRoot: ROOT1, actionTagCount: 2n },
              srcAddress: CONTRACT,
              block: { number: BLOCK, timestamp: TIMESTAMP },
              transaction: tx,
              logIndex: 10,
            },
            {
              contract: "ProtocolAdapter",
              event: "TransactionExecuted",
              params: {
                tags: [N0, C0, N1, C1],
                logicRefs: [b32("vk-n0"), b32("vk-c0"), b32("vk-n1"), b32("vk-c1")],
              },
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

  it("F1: each action's ComplianceUnit carries its OWN decoded data", async () => {
    const indexer = await run();
    const cus = await indexer.ComplianceUnit.getAll();
    expect(cus).toHaveLength(2);

    const cu0 = cus.find((c) => c.action_id === `${evmTxId}_${ROOT0}`);
    const cu1 = cus.find((c) => c.action_id === `${evmTxId}_${ROOT1}`);
    expect(cu0, "action 0 compliance unit").toBeDefined();
    expect(cu1, "action 1 compliance unit").toBeDefined();

    expect(cu0!.consumedNullifier).toBe(N0);
    expect(cu0!.createdCommitment).toBe(C0);

    // The bug: action 1 would inherit action 0's data (N0/C0).
    expect(cu1!.consumedNullifier).toBe(N1);
    expect(cu1!.createdCommitment).toBe(C1);
    expect(cu1!.consumedNullifier).not.toBe(N0);
  });

  it("F2: LogicInput.isConsumed follows tag identity, not array position", async () => {
    const indexer = await run();
    const lis = await indexer.LogicInput.getAll();

    // Action 0's logic inputs are ordered [created C0, consumed N0].
    const liC0 = lis.find((l) => l.action_id === `${evmTxId}_${ROOT0}` && l.tagHash === C0);
    const liN0 = lis.find((l) => l.action_id === `${evmTxId}_${ROOT0}` && l.tagHash === N0);
    expect(liC0, "logic input for created tag C0").toBeDefined();
    expect(liN0, "logic input for consumed tag N0").toBeDefined();

    // Despite C0 being at array index 0 (even), it is a CREATED resource.
    expect(liC0!.isConsumed).toBe(false);
    // N0 is at array index 1 (odd) but is a CONSUMED resource.
    expect(liN0!.isConsumed).toBe(true);

    // Action 1 (interleaved order) stays correct too.
    const liN1 = lis.find((l) => l.action_id === `${evmTxId}_${ROOT1}` && l.tagHash === N1);
    const liC1 = lis.find((l) => l.action_id === `${evmTxId}_${ROOT1}` && l.tagHash === C1);
    expect(liN1!.isConsumed).toBe(true);
    expect(liC1!.isConsumed).toBe(false);
  });
});
