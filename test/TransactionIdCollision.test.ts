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
});
