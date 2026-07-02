/**
 * CommitmentTreeRoot Ordering Tests
 *
 * Verifies that CommitmentTreeRoot entities preserve intra-block ordering
 * via the `logIndex` field, so consumers can sort by `{blockNumber, logIndex}`
 * to recover the original EVM event order.
 *
 * Refs #23
 */

import { describe, it, expect } from "vitest";
import { createTestIndexer } from "envio";

describe("CommitmentTreeRoot Ordering", () => {
  describe("multiple roots in the same block", () => {
    it("should store distinct logIndex values for each root", async () => {
      const indexer = createTestIndexer();

      const BLOCK = 100;
      const CONTRACT = "0x0eA3B55b68A3f307c8FE3fe66E443247c95F0CfF";
      const TX_HASH = "0xabababababababababababababababababababababababababababababababababab";

      await indexer.process({
        chains: {
          1: {
            simulate: [
              {
                contract: "ProtocolAdapter",
                event: "CommitmentTreeRootAdded",
                params: { root: "0x" + "01".repeat(32) },
                srcAddress: CONTRACT,
                block: { number: BLOCK, timestamp: 1700000000 },
                transaction: { hash: TX_HASH },
                logIndex: 5,
              },
              {
                contract: "ProtocolAdapter",
                event: "CommitmentTreeRootAdded",
                params: { root: "0x" + "02".repeat(32) },
                srcAddress: CONTRACT,
                block: { number: BLOCK, timestamp: 1700000000 },
                transaction: { hash: TX_HASH },
                logIndex: 6,
              },
              {
                contract: "ProtocolAdapter",
                event: "CommitmentTreeRootAdded",
                params: { root: "0x" + "03".repeat(32) },
                srcAddress: CONTRACT,
                block: { number: BLOCK, timestamp: 1700000000 },
                transaction: { hash: TX_HASH },
                logIndex: 7,
              },
            ],
          },
        },
      });

      const allRoots = await indexer.CommitmentTreeRoot.getAll();
      expect(allRoots).toHaveLength(3);

      const logIndices = allRoots.map((r) => r.logIndex).sort((a, b) => a - b);
      expect(logIndices).toEqual([5, 6, 7]);
    });

    it("should allow correct ordering via (blockNumber, logIndex)", async () => {
      const indexer = createTestIndexer();

      const CONTRACT = "0x0eA3B55b68A3f307c8FE3fe66E443247c95F0CfF";
      const TX_HASH = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

      // 5 roots across 2 blocks, inserted out of order
      await indexer.process({
        chains: {
          1: {
            simulate: [
              {
                contract: "ProtocolAdapter",
                event: "CommitmentTreeRootAdded",
                params: { root: "0x" + "04".repeat(32) },
                srcAddress: CONTRACT,
                block: { number: 101, timestamp: 1700000000 },
                transaction: { hash: TX_HASH },
                logIndex: 1,
              },
              {
                contract: "ProtocolAdapter",
                event: "CommitmentTreeRootAdded",
                params: { root: "0x" + "02".repeat(32) },
                srcAddress: CONTRACT,
                block: { number: 100, timestamp: 1700000000 },
                transaction: { hash: TX_HASH },
                logIndex: 7,
              },
              {
                contract: "ProtocolAdapter",
                event: "CommitmentTreeRootAdded",
                params: { root: "0x" + "05".repeat(32) },
                srcAddress: CONTRACT,
                block: { number: 101, timestamp: 1700000000 },
                transaction: { hash: TX_HASH },
                logIndex: 4,
              },
              {
                contract: "ProtocolAdapter",
                event: "CommitmentTreeRootAdded",
                params: { root: "0x" + "01".repeat(32) },
                srcAddress: CONTRACT,
                block: { number: 100, timestamp: 1700000000 },
                transaction: { hash: TX_HASH },
                logIndex: 3,
              },
              {
                contract: "ProtocolAdapter",
                event: "CommitmentTreeRootAdded",
                params: { root: "0x" + "03".repeat(32) },
                srcAddress: CONTRACT,
                block: { number: 100, timestamp: 1700000000 },
                transaction: { hash: TX_HASH },
                logIndex: 12,
              },
            ],
          },
        },
      });

      const allRoots = await indexer.CommitmentTreeRoot.getAll();
      expect(allRoots).toHaveLength(5);

      // Sort by (blockNumber, logIndex) — simulates the fixed GraphQL query
      const sorted = [...allRoots].sort(
        (a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex
      );

      // Should recover the correct EVM order regardless of insertion order
      const rootOrder = sorted.map((r) => r.root);
      expect(rootOrder).toEqual([
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
      const indexer = createTestIndexer();

      const BLOCK = 300;
      const CONTRACT = "0x0eA3B55b68A3f307c8FE3fe66E443247c95F0CfF";

      // Two separate EVM transactions in the same block
      await indexer.process({
        chains: {
          1: {
            simulate: [
              {
                contract: "ProtocolAdapter",
                event: "CommitmentTreeRootAdded",
                params: { root: "0x" + "bb".repeat(32) },
                srcAddress: CONTRACT,
                block: { number: BLOCK, timestamp: 1700000000 },
                transaction: {
                  hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
                },
                logIndex: 8,
              },
              {
                contract: "ProtocolAdapter",
                event: "CommitmentTreeRootAdded",
                params: { root: "0x" + "aa".repeat(32) },
                srcAddress: CONTRACT,
                block: { number: BLOCK, timestamp: 1700000000 },
                transaction: {
                  hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
                },
                logIndex: 3,
              },
            ],
          },
        },
      });

      const allRoots = await indexer.CommitmentTreeRoot.getAll();
      expect(allRoots).toHaveLength(2);

      // Sort by logIndex to recover EVM order
      const sorted = [...allRoots].sort((a, b) => a.logIndex - b.logIndex);
      expect(sorted[0].logIndex).toBe(3);
      expect(sorted[1].logIndex).toBe(8);
      expect(sorted[0].root).toBe("0x" + "aa".repeat(32));
      expect(sorted[1].root).toBe("0x" + "bb".repeat(32));
    });
  });
});
