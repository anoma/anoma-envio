/**
 * Transaction ID Collision Tests
 *
 * Verifies that multiple AP (Anoma Protocol) transactions within the same
 * EVM transaction (e.g., via multicall) are stored as separate Transaction
 * entities instead of overwriting each other.
 *
 * The fix uses the format {chainId}_{txHash}_{logIndex} for Transaction IDs
 * to ensure uniqueness, while EVMTransaction retains {chainId}_{txHash}.
 */

import { describe, it, expect } from "vitest";
import { createTestIndexer } from "envio";

describe("Transaction ID Collision", () => {
  const CHAIN = 1;
  const TX_HASH = "0xabababababababababababababababababababababababababababababababababab";
  const CONTRACT = "0xcccccccccccccccccccccccccccccccccccccccc";
  const BLOCK = 100;
  const TIMESTAMP = 1700000000;

  // Tags for first AP transaction
  const tags1 = ["0x" + "11".repeat(32), "0x" + "12".repeat(32)];
  const logicRefs1 = ["0x" + "a1".repeat(32), "0x" + "a2".repeat(32)];

  // Tags for second AP transaction (different tags, same EVM tx)
  const tags2 = ["0x" + "21".repeat(32), "0x" + "22".repeat(32)];
  const logicRefs2 = ["0x" + "b1".repeat(32), "0x" + "b2".repeat(32)];

  async function processTwoTransactionExecuted() {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            {
              contract: "ProtocolAdapter",
              event: "TransactionExecuted",
              params: { tags: tags1, logicRefs: logicRefs1 },
              srcAddress: CONTRACT,
              block: { number: BLOCK, timestamp: TIMESTAMP },
              transaction: { hash: TX_HASH, input: "0x", value: 0n },
              logIndex: 10,
            },
            {
              contract: "ProtocolAdapter",
              event: "TransactionExecuted",
              params: { tags: tags2, logicRefs: logicRefs2 },
              srcAddress: CONTRACT,
              block: { number: BLOCK, timestamp: TIMESTAMP },
              transaction: { hash: TX_HASH, input: "0x", value: 0n },
              logIndex: 20,
            },
          ],
        },
      },
    });
    return indexer;
  }

  it("should preserve both Transactions when two AP txs share an EVM tx", async () => {
    const indexer = await processTwoTransactionExecuted();

    const allTxs = await indexer.Transaction.getAll();
    expect(allTxs).toHaveLength(2);

    // Sort by logIndex for deterministic ordering
    const sorted = [...allTxs].sort((a, b) => a.logIndex - b.logIndex);
    expect(sorted[0].tagHashes).toEqual(tags1);
    expect(sorted[1].tagHashes).toEqual(tags2);
  });

  it("should share one EVMTransaction between both AP Transactions", async () => {
    const indexer = await processTwoTransactionExecuted();

    // Only one EVMTransaction (same EVM tx)
    const allEvmTxs = await indexer.EVMTransaction.getAll();
    expect(allEvmTxs).toHaveLength(1);
    expect(allEvmTxs[0].txHash).toBe(TX_HASH);

    // Both Transactions should reference the same EVMTransaction
    const allTxs = await indexer.Transaction.getAll();
    expect(allTxs).toHaveLength(2);

    const evmTxId = `${CHAIN}_${TX_HASH}`;
    for (const tx of allTxs) {
      expect(tx.evmTransaction_id).toBe(evmTxId);
    }
  });

  it("should create separate tags for each AP transaction", async () => {
    const indexer = await processTwoTransactionExecuted();

    const allTags = await indexer.Tag.getAll();
    expect(allTags).toHaveLength(4); // 2 tags per transaction

    const tagHashes = allTags.map((t) => t.tagHash).sort();
    const expectedHashes = [...tags1, ...tags2].sort();
    expect(tagHashes).toEqual(expectedHashes);
  });

  it("should correctly count stats for both transactions", async () => {
    const indexer = await processTwoTransactionExecuted();

    const stats = await indexer.Stats.get("global");
    expect(stats).toBeDefined();
    expect(stats!.transactions).toBe(2);
    expect(stats!.tags).toBe(4);
  });

  // ─── Action↔Transaction linkage via evmTxId (Task 1) ───────────────────────

  describe("Action linkage via evmTxId (preload-safe, no pending Map)", () => {
    const ACTION_ROOT_1 = "0x" + "a1".repeat(32);
    const ACTION_ROOT_2 = "0x" + "a2".repeat(32);

    /**
     * Simulates a multicall EVM tx with two execute() calls:
     *   ActionExecuted(action1) → TransactionExecuted(logIndex 10)
     *   ActionExecuted(action2) → TransactionExecuted(logIndex 20)
     *
     * Both ActionExecuted events share TX_HASH so evmTxId is the same.
     * The guard on transaction_id === evmTxId ensures each TransactionExecuted
     * only claims its own unlinked actions.
     */
    async function processTwoExecuteCallsWithActions() {
      const indexer = createTestIndexer();
      await indexer.process({
        chains: {
          [CHAIN]: {
            simulate: [
              // First execute(): ActionExecuted then TransactionExecuted
              {
                contract: "ProtocolAdapter",
                event: "ActionExecuted",
                params: { actionTreeRoot: ACTION_ROOT_1, actionTagCount: 0n },
                srcAddress: CONTRACT,
                block: { number: BLOCK, timestamp: TIMESTAMP },
                transaction: { hash: TX_HASH, input: "0x", value: 0n },
                logIndex: 5,
              },
              {
                contract: "ProtocolAdapter",
                event: "TransactionExecuted",
                params: { tags: tags1, logicRefs: logicRefs1 },
                srcAddress: CONTRACT,
                block: { number: BLOCK, timestamp: TIMESTAMP },
                transaction: { hash: TX_HASH, input: "0x", value: 0n },
                logIndex: 10,
              },
              // Second execute(): ActionExecuted then TransactionExecuted
              {
                contract: "ProtocolAdapter",
                event: "ActionExecuted",
                params: { actionTreeRoot: ACTION_ROOT_2, actionTagCount: 0n },
                srcAddress: CONTRACT,
                block: { number: BLOCK, timestamp: TIMESTAMP },
                transaction: { hash: TX_HASH, input: "0x", value: 0n },
                logIndex: 15,
              },
              {
                contract: "ProtocolAdapter",
                event: "TransactionExecuted",
                params: { tags: tags2, logicRefs: logicRefs2 },
                srcAddress: CONTRACT,
                block: { number: BLOCK, timestamp: TIMESTAMP },
                transaction: { hash: TX_HASH, input: "0x", value: 0n },
                logIndex: 20,
              },
            ],
          },
        },
      });
      return indexer;
    }

    it("should link each Action to its own TransactionExecuted (not the other)", async () => {
      const indexer = await processTwoExecuteCallsWithActions();

      const evmTxId = `${CHAIN}_${TX_HASH}`;
      const txId1 = `${CHAIN}_${TX_HASH}_10`;
      const txId2 = `${CHAIN}_${TX_HASH}_20`;

      const allActions = await indexer.Action.getAll();
      expect(allActions).toHaveLength(2);

      const action1 = allActions.find((a) => a.actionTreeRoot === ACTION_ROOT_1);
      const action2 = allActions.find((a) => a.actionTreeRoot === ACTION_ROOT_2);

      expect(action1, "action1 should exist").toBeDefined();
      expect(action2, "action2 should exist").toBeDefined();

      // Each action's evmTxId must be set (new field added in Task 1)
      expect(action1!.evmTxId).toBe(evmTxId);
      expect(action2!.evmTxId).toBe(evmTxId);

      // Each action must be linked to its own Transaction, not the other's
      expect(action1!.transaction_id).toBe(txId1);
      expect(action2!.transaction_id).toBe(txId2);

      // Sanity: neither action should still be using the temporary evmTxId
      expect(action1!.transaction_id).not.toBe(evmTxId);
      expect(action2!.transaction_id).not.toBe(evmTxId);
    });
  });
});
