/**
 * ChainStats / ChainDailyStats / ChainLogicRef Counter Tests
 *
 * Verifies that per-chain counter entities are populated alongside the
 * global Stats / DailyStats, with correct per-chain isolation.
 *
 * Refs anoma/anoma-explorer#139
 */

import { describe, it, expect } from "vitest";
import { createTestIndexer } from "envio";

const STATS_ID = "global";
const CHAIN_A = 1;
const CHAIN_B = 42161;

// 2026-05-19 00:00 UTC — picked so all events land in the same UTC day.
const TIMESTAMP = 1779148800;
const DATE_KEY = "2026-05-19";

const TX_HASH_A = "0xabababababababababababababababababababababababababababababababababab";
const TX_HASH_B = "0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd";

describe("ChainStats / ChainDailyStats Counters", () => {
  describe("single chain", () => {
    it("should increment ChainStats keyed by chainId", async () => {
      const indexer = createTestIndexer();
      await indexer.process({
        chains: {
          [CHAIN_A]: {
            simulate: [
              {
                contract: "ProtocolAdapter",
                event: "ResourcePayload",
                params: { tag: "0x" + "aa".repeat(32), index: 0n, blob: "0x00" },
                block: { number: 100, timestamp: TIMESTAMP },
                transaction: { hash: TX_HASH_A },
                logIndex: 0,
              },
            ],
          },
        },
      });

      const chainStats = await indexer.ChainStats.get(String(CHAIN_A));
      expect(chainStats, "ChainStats row missing").toBeDefined();
      expect(chainStats!.chainId).toBe(CHAIN_A);
      expect(chainStats!.resourcePayloads).toBe(1);
      expect(chainStats!.discoveryPayloads).toBe(0);
    });

    it("should increment ChainDailyStats keyed by '<chainId>-<date>'", async () => {
      const indexer = createTestIndexer();
      await indexer.process({
        chains: {
          [CHAIN_A]: {
            simulate: [
              {
                contract: "ProtocolAdapter",
                event: "ResourcePayload",
                params: { tag: "0x" + "aa".repeat(32), index: 0n, blob: "0x00" },
                block: { number: 100, timestamp: TIMESTAMP },
                transaction: { hash: TX_HASH_A },
                logIndex: 0,
              },
            ],
          },
        },
      });

      const chainDaily = await indexer.ChainDailyStats.get(`${CHAIN_A}-${DATE_KEY}`);
      expect(chainDaily, "ChainDailyStats row missing").toBeDefined();
      expect(chainDaily!.chainId).toBe(CHAIN_A);
      expect(chainDaily!.date).toBe(DATE_KEY);
      expect(chainDaily!.resourcePayloads).toBe(1);
    });
  });

  describe("multi-chain isolation", () => {
    it("should keep ChainStats counters separate per chain", async () => {
      const indexer = createTestIndexer();
      await indexer.process({
        chains: {
          [CHAIN_A]: {
            simulate: [
              {
                contract: "ProtocolAdapter",
                event: "ResourcePayload",
                params: { tag: "0x" + "aa".repeat(32), index: 0n, blob: "0x00" },
                block: { number: 100, timestamp: TIMESTAMP },
                transaction: { hash: TX_HASH_A },
                logIndex: 0,
              },
            ],
          },
          [CHAIN_B]: {
            simulate: [
              {
                contract: "ProtocolAdapter",
                event: "ResourcePayload",
                params: { tag: "0x" + "bb".repeat(32), index: 0n, blob: "0x00" },
                block: { number: 200, timestamp: TIMESTAMP },
                transaction: { hash: TX_HASH_B },
                logIndex: 0,
              },
              {
                contract: "ProtocolAdapter",
                event: "ResourcePayload",
                params: { tag: "0x" + "cc".repeat(32), index: 1n, blob: "0x00" },
                block: { number: 201, timestamp: TIMESTAMP },
                transaction: { hash: TX_HASH_B },
                logIndex: 1,
              },
            ],
          },
        },
      });

      const statsA = await indexer.ChainStats.get(String(CHAIN_A));
      const statsB = await indexer.ChainStats.get(String(CHAIN_B));
      expect(statsA!.resourcePayloads).toBe(1);
      expect(statsB!.resourcePayloads).toBe(2);

      // Global Stats should equal the sum across chains.
      const global = await indexer.Stats.get(STATS_ID);
      expect(global!.resourcePayloads).toBe(3);
    });

    it("should not create a ChainStats row for chains that saw no events", async () => {
      const indexer = createTestIndexer();
      await indexer.process({
        chains: {
          [CHAIN_A]: {
            simulate: [
              {
                contract: "ProtocolAdapter",
                event: "ResourcePayload",
                params: { tag: "0x" + "aa".repeat(32), index: 0n, blob: "0x00" },
                block: { number: 100, timestamp: TIMESTAMP },
                transaction: { hash: TX_HASH_A },
                logIndex: 0,
              },
            ],
          },
        },
      });

      const statsB = await indexer.ChainStats.get(String(CHAIN_B));
      expect(statsB).toBeUndefined();
    });
  });

  describe("ChainLogicRef distinct counting", () => {
    const TAGS = ["0x" + "11".repeat(32), "0x" + "12".repeat(32)];
    const SHARED_LOGIC = "0x" + "ff".repeat(32);
    const UNIQUE_LOGIC_B = "0x" + "ee".repeat(32);

    it("should count a verifyingKey once per chain even when shared across chains", async () => {
      const indexer = createTestIndexer();
      await indexer.process({
        chains: {
          // Chain A: one tx with logic ref SHARED_LOGIC used twice (unique-set size 1).
          [CHAIN_A]: {
            simulate: [
              {
                contract: "ProtocolAdapter",
                event: "TransactionExecuted",
                params: { tags: TAGS, logicRefs: [SHARED_LOGIC, SHARED_LOGIC] },
                block: { number: 100, timestamp: TIMESTAMP },
                transaction: { hash: TX_HASH_A, input: "0x", value: 0n },
                logIndex: 0,
              },
            ],
          },
          // Chain B: one tx with SHARED_LOGIC (same key, different chain) + UNIQUE_LOGIC_B.
          [CHAIN_B]: {
            simulate: [
              {
                contract: "ProtocolAdapter",
                event: "TransactionExecuted",
                params: { tags: TAGS, logicRefs: [SHARED_LOGIC, UNIQUE_LOGIC_B] },
                block: { number: 200, timestamp: TIMESTAMP },
                transaction: { hash: TX_HASH_B, input: "0x", value: 0n },
                logIndex: 0,
              },
            ],
          },
        },
      });

      // Global: 2 distinct logics (SHARED_LOGIC, UNIQUE_LOGIC_B).
      const global = await indexer.Stats.get(STATS_ID);
      expect(global!.distinctLogics).toBe(2);

      // Chain A: 1 distinct logic (SHARED_LOGIC).
      const statsA = await indexer.ChainStats.get(String(CHAIN_A));
      expect(statsA!.distinctLogics).toBe(1);

      // Chain B: 2 distinct logics (SHARED_LOGIC seen first on B + UNIQUE_LOGIC_B).
      const statsB = await indexer.ChainStats.get(String(CHAIN_B));
      expect(statsB!.distinctLogics).toBe(2);
    });

    it("should write ChainLogicRef rows keyed by '<chainId>-<verifyingKey>'", async () => {
      const indexer = createTestIndexer();
      await indexer.process({
        chains: {
          [CHAIN_A]: {
            simulate: [
              {
                contract: "ProtocolAdapter",
                event: "TransactionExecuted",
                params: { tags: TAGS, logicRefs: [SHARED_LOGIC, SHARED_LOGIC] },
                block: { number: 100, timestamp: TIMESTAMP },
                transaction: { hash: TX_HASH_A, input: "0x", value: 0n },
                logIndex: 0,
              },
            ],
          },
        },
      });

      const ref = await indexer.ChainLogicRef.get(`${CHAIN_A}-${SHARED_LOGIC}`);
      expect(ref, "ChainLogicRef row missing").toBeDefined();
      expect(ref!.chainId).toBe(CHAIN_A);
      expect(ref!.verifyingKey).toBe(SHARED_LOGIC);
      expect(ref!.firstSeenTxHash).toBe(TX_HASH_A);
    });
  });
});
