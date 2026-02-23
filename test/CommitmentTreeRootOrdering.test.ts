/**
 * CommitmentTreeRoot Ordering Tests
 *
 * Verifies that CommitmentTreeRoot entities preserve intra-block ordering
 * via the `logIndex` field, so consumers can sort by `{blockNumber, logIndex}`
 * to recover the original EVM event order.
 *
 * Refs #23
 */

import { expect } from "chai";
import { TestHelpers } from "generated";

const { MockDb, ProtocolAdapter } = TestHelpers;

describe("CommitmentTreeRoot Ordering", () => {
  describe("multiple roots in the same block", () => {
    it("should store distinct logIndex values for each root", async () => {
      let db = MockDb.createMockDb();

      const BLOCK = 100;
      const CHAIN = 1;
      const CONTRACT = "0x0eA3B55b68A3f307c8FE3fe66E443247c95F0CfF";
      const TX_HASH = "0x" + "ab".repeat(32);

      const roots = [
        { root: "0x" + "01".repeat(32), logIndex: 5 },
        { root: "0x" + "02".repeat(32), logIndex: 6 },
        { root: "0x" + "03".repeat(32), logIndex: 7 },
      ];

      for (const r of roots) {
        const event = ProtocolAdapter.CommitmentTreeRootAdded.createMockEvent({
          root: r.root,
          mockEventData: {
            chainId: CHAIN,
            srcAddress: CONTRACT,
            logIndex: r.logIndex,
            block: { number: BLOCK, timestamp: 1700000000 },
            transaction: { hash: TX_HASH },
          },
        });
        db = await ProtocolAdapter.CommitmentTreeRootAdded.processEvent({
          event,
          mockDb: db,
        });
      }

      const allRoots = db.entities.CommitmentTreeRoot.getAll();
      expect(allRoots).to.have.length(3);

      const logIndices = allRoots.map((r) => r.logIndex).sort((a, b) => a - b);
      expect(logIndices).to.deep.equal([5, 6, 7]);
    });

    it("should allow correct ordering via (blockNumber, logIndex)", async () => {
      let db = MockDb.createMockDb();

      const CHAIN = 1;
      const CONTRACT = "0x0eA3B55b68A3f307c8FE3fe66E443247c95F0CfF";
      const TX_HASH = "0x" + "ff".repeat(32);

      // 5 roots across 2 blocks, inserted out of order
      const events = [
        { root: "0x" + "04".repeat(32), block: 101, logIndex: 1 },
        { root: "0x" + "02".repeat(32), block: 100, logIndex: 7 },
        { root: "0x" + "05".repeat(32), block: 101, logIndex: 4 },
        { root: "0x" + "01".repeat(32), block: 100, logIndex: 3 },
        { root: "0x" + "03".repeat(32), block: 100, logIndex: 12 },
      ];

      for (const e of events) {
        const event = ProtocolAdapter.CommitmentTreeRootAdded.createMockEvent({
          root: e.root,
          mockEventData: {
            chainId: CHAIN,
            srcAddress: CONTRACT,
            logIndex: e.logIndex,
            block: { number: e.block, timestamp: 1700000000 },
            transaction: { hash: TX_HASH },
          },
        });
        db = await ProtocolAdapter.CommitmentTreeRootAdded.processEvent({
          event,
          mockDb: db,
        });
      }

      const allRoots = db.entities.CommitmentTreeRoot.getAll();
      expect(allRoots).to.have.length(5);

      // Sort by (blockNumber, logIndex) — simulates the fixed GraphQL query
      const sorted = [...allRoots].sort(
        (a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex
      );

      // Should recover the correct EVM order regardless of insertion order
      const rootOrder = sorted.map((r) => r.root);
      expect(rootOrder).to.deep.equal([
        "0x" + "01".repeat(32), // block 100, logIndex 3
        "0x" + "02".repeat(32), // block 100, logIndex 7
        "0x" + "03".repeat(32), // block 100, logIndex 12
        "0x" + "04".repeat(32), // block 101, logIndex 1
        "0x" + "05".repeat(32), // block 101, logIndex 4
      ]);
    });
  });

  describe("roots from different transactions in the same block", () => {
    it("should be orderable by logIndex even across txs", async () => {
      let db = MockDb.createMockDb();

      const BLOCK = 300;
      const CHAIN = 1;
      const CONTRACT = "0x0eA3B55b68A3f307c8FE3fe66E443247c95F0CfF";

      // Two separate EVM transactions in the same block
      const scenarios = [
        { root: "0x" + "bb".repeat(32), txHash: "0x" + "22".repeat(32), logIndex: 8 },
        { root: "0x" + "aa".repeat(32), txHash: "0x" + "11".repeat(32), logIndex: 3 },
      ];

      for (const s of scenarios) {
        const event = ProtocolAdapter.CommitmentTreeRootAdded.createMockEvent({
          root: s.root,
          mockEventData: {
            chainId: CHAIN,
            srcAddress: CONTRACT,
            logIndex: s.logIndex,
            block: { number: BLOCK, timestamp: 1700000000 },
            transaction: { hash: s.txHash },
          },
        });
        db = await ProtocolAdapter.CommitmentTreeRootAdded.processEvent({
          event,
          mockDb: db,
        });
      }

      const allRoots = db.entities.CommitmentTreeRoot.getAll();
      expect(allRoots).to.have.length(2);

      // Sort by logIndex to recover EVM order
      const sorted = [...allRoots].sort((a, b) => a.logIndex - b.logIndex);
      expect(sorted[0].logIndex).to.equal(3);
      expect(sorted[1].logIndex).to.equal(8);
      expect(sorted[0].root).to.equal("0x" + "aa".repeat(32));
      expect(sorted[1].root).to.equal("0x" + "bb".repeat(32));
    });
  });
});
