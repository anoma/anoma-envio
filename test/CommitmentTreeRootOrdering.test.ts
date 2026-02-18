/**
 * CommitmentTreeRoot Ordering Tests
 *
 * Demonstrates that CommitmentTreeRoot entities lose their intra-block
 * ordering because:
 *   1. `index` is always hardcoded to 0
 *   2. `logIndex` is not stored as a queryable field
 *   3. GraphQL queries sort only by `blockNumber` — within the same block,
 *      order is undefined
 *
 * This is the likely root cause of the intermittent wrong-Merkle-path bug:
 * when multiple commitment roots land in the same block, consumers cannot
 * recover the original insertion order, so the rebuilt tree differs between
 * DB restarts.
 *
 * Refs: Slack thread on non-existing-root failures after indexer rebuild.
 */

import { expect } from "chai";
import { TestHelpers } from "generated";

const { MockDb, ProtocolAdapter } = TestHelpers;

describe("CommitmentTreeRoot Ordering Bug", () => {
  // -------------------------------------------------------
  // Scenario 1: Multiple roots in the SAME block
  // -------------------------------------------------------
  describe("multiple roots in the same block", () => {
    it("all roots get index=0 — ordering within a block is lost", async () => {
      let db = MockDb.createMockDb();

      const BLOCK = 100;
      const CHAIN = 1;
      const CONTRACT = "0x0eA3B55b68A3f307c8FE3fe66E443247c95F0CfF";
      const TX_HASH = "0x" + "ab".repeat(32);

      // Simulate 3 CommitmentTreeRootAdded events in the SAME block,
      // each with a different logIndex (as the EVM would emit them).
      const roots = [
        "0x" + "01".repeat(32), // root A — logIndex 5
        "0x" + "02".repeat(32), // root B — logIndex 6
        "0x" + "03".repeat(32), // root C — logIndex 7
      ];

      for (let i = 0; i < roots.length; i++) {
        const event = ProtocolAdapter.CommitmentTreeRootAdded.createMockEvent({
          root: roots[i],
          mockEventData: {
            chainId: CHAIN,
            srcAddress: CONTRACT,
            logIndex: 5 + i, // distinct log indices
            block: { number: BLOCK, timestamp: 1700000000 },
            transaction: { hash: TX_HASH },
          },
        });

        db = await ProtocolAdapter.CommitmentTreeRootAdded.processEvent({
          event,
          mockDb: db,
        });
      }

      // Retrieve all stored CommitmentTreeRoot entities
      const allRoots = db.entities.CommitmentTreeRoot.getAll();
      expect(allRoots).to.have.length(3);

      // BUG: Every root has index=0 — there is no way to distinguish
      // the order of roots within this block.
      const indices = allRoots.map((r) => r.index);
      console.log("\n  Stored indices:", indices);
      console.log("  Expected something like [0, 1, 2] to preserve order");

      // This assertion documents the bug: all indices are 0
      expect(indices).to.deep.equal([0, 0, 0]);

      // Since all roots share the same blockNumber AND the same index,
      // a consumer sorting by (blockNumber, index) gets NO ordering
      // guarantee within the block.
      const blockNumbers = allRoots.map((r) => r.blockNumber);
      expect(new Set(blockNumbers).size).to.equal(1); // all same block

      // The entity has no `logIndex` field that could serve as tiebreaker.
      // The logIndex is embedded in the entity ID string but cannot be
      // sorted numerically via GraphQL.
      const ids = allRoots.map((r) => r.id);
      console.log("  Entity IDs (logIndex embedded, not sortable numerically):");
      ids.forEach((id) => console.log(`    ${id}`));
    });

    it("different insertion orders produce entities with identical fields", async () => {
      // Process roots in REVERSE logIndex order to show that the stored
      // entities are indistinguishable regardless of insertion order.
      const BLOCK = 200;
      const CHAIN = 1;
      const CONTRACT = "0x0eA3B55b68A3f307c8FE3fe66E443247c95F0CfF";
      const TX_HASH = "0x" + "cd".repeat(32);

      const roots = ["0x" + "01".repeat(32), "0x" + "02".repeat(32), "0x" + "03".repeat(32)];

      // Process in forward order
      let dbForward = MockDb.createMockDb();
      for (let i = 0; i < roots.length; i++) {
        const event = ProtocolAdapter.CommitmentTreeRootAdded.createMockEvent({
          root: roots[i],
          mockEventData: {
            chainId: CHAIN,
            srcAddress: CONTRACT,
            logIndex: 10 + i,
            block: { number: BLOCK, timestamp: 1700000000 },
            transaction: { hash: TX_HASH },
          },
        });
        dbForward = await ProtocolAdapter.CommitmentTreeRootAdded.processEvent({
          event,
          mockDb: dbForward,
        });
      }

      // Process in REVERSE order
      let dbReverse = MockDb.createMockDb();
      for (let i = roots.length - 1; i >= 0; i--) {
        const event = ProtocolAdapter.CommitmentTreeRootAdded.createMockEvent({
          root: roots[i],
          mockEventData: {
            chainId: CHAIN,
            srcAddress: CONTRACT,
            logIndex: 10 + i,
            block: { number: BLOCK, timestamp: 1700000000 },
            transaction: { hash: TX_HASH },
          },
        });
        dbReverse = await ProtocolAdapter.CommitmentTreeRootAdded.processEvent({
          event,
          mockDb: dbReverse,
        });
      }

      const forwardRoots = dbForward.entities.CommitmentTreeRoot.getAll();
      const reverseRoots = dbReverse.entities.CommitmentTreeRoot.getAll();

      // Both produce the same set of entities with identical fields.
      // A consumer sorting by (blockNumber, index) would get the same
      // (meaningless) order — the original EVM log order is lost.
      expect(forwardRoots.length).to.equal(reverseRoots.length);

      for (const fwd of forwardRoots) {
        const rev = reverseRoots.find((r) => r.root === fwd.root);
        expect(rev).to.not.be.undefined;
        expect(rev!.index).to.equal(fwd.index); // both 0
        expect(rev!.blockNumber).to.equal(fwd.blockNumber);
        // No logIndex field to differentiate
      }

      console.log("\n  Forward and reverse insertion produce identical entity fields.");
      console.log("  Original EVM ordering is irrecoverable from the stored data.");
    });
  });

  // -------------------------------------------------------
  // Scenario 2: Roots across different transactions in the same block
  // -------------------------------------------------------
  describe("roots from different transactions in the same block", () => {
    it("no transactionIndex to order txs within a block", async () => {
      let db = MockDb.createMockDb();

      const BLOCK = 300;
      const CHAIN = 1;
      const CONTRACT = "0x0eA3B55b68A3f307c8FE3fe66E443247c95F0CfF";

      // Two separate EVM transactions in the same block, each adding a root.
      const scenarios = [
        {
          root: "0x" + "aa".repeat(32),
          txHash: "0x" + "11".repeat(32),
          logIndex: 3, // tx1 fires earlier
        },
        {
          root: "0x" + "bb".repeat(32),
          txHash: "0x" + "22".repeat(32),
          logIndex: 8, // tx2 fires later
        },
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

      // Both have the same blockNumber and index=0
      expect(allRoots[0].blockNumber).to.equal(BLOCK);
      expect(allRoots[1].blockNumber).to.equal(BLOCK);
      expect(allRoots[0].index).to.equal(0);
      expect(allRoots[1].index).to.equal(0);

      // The only distinguishing field is txHash, but there is no
      // transactionIndex to determine which tx came first in the block.
      console.log("\n  Two roots, same block, different txs:");
      console.log(
        `    Root A: block=${allRoots[0].blockNumber}, index=${allRoots[0].index}, tx=${allRoots[0].txHash.slice(0, 20)}...`
      );
      console.log(
        `    Root B: block=${allRoots[1].blockNumber}, index=${allRoots[1].index}, tx=${allRoots[1].txHash.slice(0, 20)}...`
      );
      console.log("  No transactionIndex or logIndex field to determine ordering.");
    });
  });

  // -------------------------------------------------------
  // Scenario 3: GraphQL sort simulation
  // -------------------------------------------------------
  describe("simulated GraphQL sort (blockNumber only)", () => {
    it("roots in the same block are returned in arbitrary order", async () => {
      let db = MockDb.createMockDb();

      const CHAIN = 1;
      const CONTRACT = "0x0eA3B55b68A3f307c8FE3fe66E443247c95F0CfF";
      const TX_HASH = "0x" + "ff".repeat(32);

      // 5 roots across 2 blocks
      const events = [
        { root: "0x" + "01".repeat(32), block: 100, logIndex: 3 },
        { root: "0x" + "02".repeat(32), block: 100, logIndex: 7 },
        { root: "0x" + "03".repeat(32), block: 100, logIndex: 12 },
        { root: "0x" + "04".repeat(32), block: 101, logIndex: 1 },
        { root: "0x" + "05".repeat(32), block: 101, logIndex: 4 },
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

      // Simulate what GraphQL `order_by: {blockNumber: asc}` would do:
      // sort by blockNumber only, no secondary sort.
      const sorted = [...allRoots].sort((a, b) => a.blockNumber - b.blockNumber);

      // Within block 100, we have 3 roots — their relative order is undefined.
      const block100Roots = sorted.filter((r) => r.blockNumber === 100);
      expect(block100Roots).to.have.length(3);

      // All have index=0, so there's no way to sort them correctly.
      const block100Indices = block100Roots.map((r) => r.index);
      expect(block100Indices).to.deep.equal([0, 0, 0]);

      console.log("\n  After sorting by blockNumber (simulating GraphQL order_by):");
      console.log("  Block 100 roots (should be ordered by logIndex 3, 7, 12):");
      block100Roots.forEach((r) => {
        console.log(`    root=${r.root.slice(0, 20)}... index=${r.index} (no logIndex field)`);
      });
      console.log("  => Consumer CANNOT determine correct order for Merkle tree construction.");
    });
  });
});
