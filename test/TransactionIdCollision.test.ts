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

import { expect } from "chai";
import { TestHelpers } from "generated";

const { MockDb, ProtocolAdapter } = TestHelpers;

describe("Transaction ID Collision", () => {
  const CHAIN = 1;
  const TX_HASH = "0x" + "ab".repeat(32);
  const CONTRACT = "0x" + "cc".repeat(20);
  const BLOCK = 100;
  const TIMESTAMP = 1700000000;

  // Tags for first AP transaction
  const tags1 = ["0x" + "11".repeat(32), "0x" + "12".repeat(32)];
  const logicRefs1 = ["0x" + "a1".repeat(32), "0x" + "a2".repeat(32)];

  // Tags for second AP transaction (different tags, same EVM tx)
  const tags2 = ["0x" + "21".repeat(32), "0x" + "22".repeat(32)];
  const logicRefs2 = ["0x" + "b1".repeat(32), "0x" + "b2".repeat(32)];

  async function processTwoTransactionExecuted() {
    let db = MockDb.createMockDb();

    const event1 = ProtocolAdapter.TransactionExecuted.createMockEvent({
      tags: tags1,
      logicRefs: logicRefs1,
      mockEventData: {
        chainId: CHAIN,
        srcAddress: CONTRACT,
        logIndex: 10,
        block: { number: BLOCK, timestamp: TIMESTAMP },
        transaction: { hash: TX_HASH },
      },
    });
    db = await ProtocolAdapter.TransactionExecuted.processEvent({
      event: event1,
      mockDb: db,
    });

    const event2 = ProtocolAdapter.TransactionExecuted.createMockEvent({
      tags: tags2,
      logicRefs: logicRefs2,
      mockEventData: {
        chainId: CHAIN,
        srcAddress: CONTRACT,
        logIndex: 20,
        block: { number: BLOCK, timestamp: TIMESTAMP },
        transaction: { hash: TX_HASH },
      },
    });
    db = await ProtocolAdapter.TransactionExecuted.processEvent({
      event: event2,
      mockDb: db,
    });

    return db;
  }

  it("should preserve both Transactions when two AP txs share an EVM tx", async () => {
    const db = await processTwoTransactionExecuted();

    const allTxs = db.entities.Transaction.getAll();
    expect(allTxs).to.have.length(2);

    // Sort by logIndex for deterministic ordering
    const sorted = [...allTxs].sort((a, b) => a.logIndex - b.logIndex);
    expect(sorted[0].tagHashes).to.deep.equal(tags1);
    expect(sorted[1].tagHashes).to.deep.equal(tags2);
  });

  it("should share one EVMTransaction between both AP Transactions", async () => {
    const db = await processTwoTransactionExecuted();

    // Only one EVMTransaction (same EVM tx)
    const allEvmTxs = db.entities.EVMTransaction.getAll();
    expect(allEvmTxs).to.have.length(1);
    expect(allEvmTxs[0].txHash).to.equal(TX_HASH);

    // Both Transactions should reference the same EVMTransaction
    const allTxs = db.entities.Transaction.getAll();
    expect(allTxs).to.have.length(2);

    const evmTxId = `${CHAIN}_${TX_HASH}`;
    for (const tx of allTxs) {
      expect(tx.evmTransaction_id).to.equal(evmTxId);
    }
  });

  it("should create separate tags for each AP transaction", async () => {
    const db = await processTwoTransactionExecuted();

    const allTags = db.entities.Tag.getAll();
    expect(allTags).to.have.length(4); // 2 tags per transaction

    const tagHashes = allTags.map((t) => t.tagHash).sort();
    const expectedHashes = [...tags1, ...tags2].sort();
    expect(tagHashes).to.deep.equal(expectedHashes);
  });

  it("should correctly count stats for both transactions", async () => {
    const db = await processTwoTransactionExecuted();

    const stats = db.entities.Stats.get("global");
    expect(stats).to.not.be.undefined;
    expect(stats!.transactions).to.equal(2);
    expect(stats!.tags).to.equal(4);
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
      let db = MockDb.createMockDb();

      // First execute(): ActionExecuted then TransactionExecuted
      const actionEvent1 = ProtocolAdapter.ActionExecuted.createMockEvent({
        actionTreeRoot: ACTION_ROOT_1,
        actionTagCount: BigInt(0),
        mockEventData: {
          chainId: CHAIN,
          srcAddress: CONTRACT,
          logIndex: 5,
          block: { number: BLOCK, timestamp: TIMESTAMP },
          transaction: { hash: TX_HASH },
        },
      });
      db = await ProtocolAdapter.ActionExecuted.processEvent({
        event: actionEvent1,
        mockDb: db,
      });

      const txEvent1 = ProtocolAdapter.TransactionExecuted.createMockEvent({
        tags: tags1,
        logicRefs: logicRefs1,
        mockEventData: {
          chainId: CHAIN,
          srcAddress: CONTRACT,
          logIndex: 10,
          block: { number: BLOCK, timestamp: TIMESTAMP },
          transaction: { hash: TX_HASH },
        },
      });
      db = await ProtocolAdapter.TransactionExecuted.processEvent({
        event: txEvent1,
        mockDb: db,
      });

      // Second execute(): ActionExecuted then TransactionExecuted
      const actionEvent2 = ProtocolAdapter.ActionExecuted.createMockEvent({
        actionTreeRoot: ACTION_ROOT_2,
        actionTagCount: BigInt(0),
        mockEventData: {
          chainId: CHAIN,
          srcAddress: CONTRACT,
          logIndex: 15,
          block: { number: BLOCK, timestamp: TIMESTAMP },
          transaction: { hash: TX_HASH },
        },
      });
      db = await ProtocolAdapter.ActionExecuted.processEvent({
        event: actionEvent2,
        mockDb: db,
      });

      const txEvent2 = ProtocolAdapter.TransactionExecuted.createMockEvent({
        tags: tags2,
        logicRefs: logicRefs2,
        mockEventData: {
          chainId: CHAIN,
          srcAddress: CONTRACT,
          logIndex: 20,
          block: { number: BLOCK, timestamp: TIMESTAMP },
          transaction: { hash: TX_HASH },
        },
      });
      db = await ProtocolAdapter.TransactionExecuted.processEvent({
        event: txEvent2,
        mockDb: db,
      });

      return db;
    }

    it("should link each Action to its own TransactionExecuted (not the other)", async () => {
      const db = await processTwoExecuteCallsWithActions();

      const evmTxId = `${CHAIN}_${TX_HASH}`;
      const txId1 = `${CHAIN}_${TX_HASH}_10`;
      const txId2 = `${CHAIN}_${TX_HASH}_20`;

      const allActions = db.entities.Action.getAll();
      expect(allActions).to.have.length(2);

      const action1 = allActions.find((a) => a.actionTreeRoot === ACTION_ROOT_1);
      const action2 = allActions.find((a) => a.actionTreeRoot === ACTION_ROOT_2);

      expect(action1, "action1 should exist").to.not.be.undefined;
      expect(action2, "action2 should exist").to.not.be.undefined;

      // Each action's evmTxId must be set (new field added in Task 1)
      expect(action1!.evmTxId).to.equal(evmTxId, "action1.evmTxId should match the EVM tx");
      expect(action2!.evmTxId).to.equal(evmTxId, "action2.evmTxId should match the EVM tx");

      // Each action must be linked to its own Transaction, not the other's
      expect(action1!.transaction_id).to.equal(
        txId1,
        "action1 should be linked to the first TransactionExecuted (logIndex 10)"
      );
      expect(action2!.transaction_id).to.equal(
        txId2,
        "action2 should be linked to the second TransactionExecuted (logIndex 20)"
      );

      // Sanity: neither action should still be using the temporary evmTxId
      expect(action1!.transaction_id).to.not.equal(
        evmTxId,
        "action1 must not retain the temporary evmTxId"
      );
      expect(action2!.transaction_id).to.not.equal(
        evmTxId,
        "action2 must not retain the temporary evmTxId"
      );
    });
  });
});
