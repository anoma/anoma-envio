/**
 * DailyStats Counter Tests
 *
 * Verifies that every handler increments DailyStats counters in addition
 * to the global Stats singleton. Mirrors StatsCounters.test.ts patterns.
 *
 * Refs #7
 */

import { describe, it, expect } from "vitest";
import { createTestIndexer } from "envio";

// Default mock-event block.timestamp is 0, which maps to "1970-01-01"
const DEFAULT_DAY_KEY = "1970-01-01";

const TX_HASH = "0xabababababababababababababababababababababababababababababababababab";
const FORWARDER = "0xffffffffffffffffffffffffffffffffffffffff";

describe("DailyStats Counters", () => {
  describe("resourcePayloads", () => {
    it("should increment DailyStats.resourcePayloads on ResourcePayload event", async () => {
      const indexer = createTestIndexer();
      await indexer.process({
        chains: {
          1: {
            simulate: [
              {
                contract: "ProtocolAdapter",
                event: "ResourcePayload",
                params: { tag: "0x" + "aa".repeat(32), index: 0n, blob: "0x00" },
                block: { number: 100, timestamp: 0 },
                transaction: { hash: TX_HASH },
                logIndex: 0,
              },
            ],
          },
        },
      });

      const daily = await indexer.DailyStats.get(DEFAULT_DAY_KEY);
      expect(daily).toBeDefined();
      expect(daily!.resourcePayloads).toBe(1n);
      expect(daily!.dayTimestamp).toBe(0n);
    });

    it("should accumulate DailyStats.resourcePayloads across multiple events", async () => {
      const indexer = createTestIndexer();
      await indexer.process({
        chains: {
          1: {
            simulate: [
              {
                contract: "ProtocolAdapter",
                event: "ResourcePayload",
                params: { tag: "0x" + "aa".repeat(32), index: 0n, blob: "0x00" },
                block: { number: 100, timestamp: 0 },
                transaction: { hash: TX_HASH },
                logIndex: 0,
              },
              {
                contract: "ProtocolAdapter",
                event: "ResourcePayload",
                params: { tag: "0x" + "bb".repeat(32), index: 1n, blob: "0x00" },
                block: { number: 100, timestamp: 0 },
                transaction: { hash: TX_HASH },
                logIndex: 1,
              },
            ],
          },
        },
      });

      const daily = await indexer.DailyStats.get(DEFAULT_DAY_KEY);
      expect(daily).toBeDefined();
      expect(daily!.resourcePayloads).toBe(2n);
    });
  });

  describe("discoveryPayloads", () => {
    it("should increment DailyStats.discoveryPayloads on DiscoveryPayload event", async () => {
      const indexer = createTestIndexer();
      await indexer.process({
        chains: {
          1: {
            simulate: [
              {
                contract: "ProtocolAdapter",
                event: "DiscoveryPayload",
                params: { tag: "0x" + "cc".repeat(32), index: 0n, blob: "0x00" },
                block: { number: 100, timestamp: 0 },
                logIndex: 0,
              },
            ],
          },
        },
      });

      const daily = await indexer.DailyStats.get(DEFAULT_DAY_KEY);
      expect(daily).toBeDefined();
      expect(daily!.discoveryPayloads).toBe(1n);
    });
  });

  describe("externalCalls", () => {
    it("should increment DailyStats.externalCalls on ExternalPayload event", async () => {
      const indexer = createTestIndexer();
      await indexer.process({
        chains: {
          1: {
            simulate: [
              {
                contract: "ProtocolAdapter",
                event: "ExternalPayload",
                params: { tag: "0x" + "dd".repeat(32), index: 0n, blob: "0x00" },
                block: { number: 100, timestamp: 0 },
                logIndex: 0,
              },
            ],
          },
        },
      });

      const daily = await indexer.DailyStats.get(DEFAULT_DAY_KEY);
      expect(daily).toBeDefined();
      expect(daily!.externalCalls).toBe(1n);
    });
  });

  describe("applicationPayloads", () => {
    it("should increment DailyStats.applicationPayloads on ApplicationPayload event", async () => {
      const indexer = createTestIndexer();
      await indexer.process({
        chains: {
          1: {
            simulate: [
              {
                contract: "ProtocolAdapter",
                event: "ApplicationPayload",
                params: { tag: "0x" + "ee".repeat(32), index: 0n, blob: "0x00" },
                block: { number: 100, timestamp: 0 },
                logIndex: 0,
              },
            ],
          },
        },
      });

      const daily = await indexer.DailyStats.get(DEFAULT_DAY_KEY);
      expect(daily).toBeDefined();
      expect(daily!.applicationPayloads).toBe(1n);
    });
  });

  describe("forwarderCalls", () => {
    it("should increment DailyStats.forwarderCalls on ForwarderCallExecuted event", async () => {
      const indexer = createTestIndexer();
      await indexer.process({
        chains: {
          1: {
            simulate: [
              {
                contract: "ProtocolAdapter",
                event: "ForwarderCallExecuted",
                params: {
                  untrustedForwarder: FORWARDER,
                  input: "0xdeadbeef",
                  output: "0xcafebabe",
                },
                block: { number: 100, timestamp: 0 },
                transaction: { hash: TX_HASH },
                logIndex: 0,
              },
            ],
          },
        },
      });

      const daily = await indexer.DailyStats.get(DEFAULT_DAY_KEY);
      expect(daily).toBeDefined();
      expect(daily!.forwarderCalls).toBe(1n);
    });
  });

  describe("commitmentRoots", () => {
    it("should increment DailyStats.commitmentRoots on CommitmentTreeRootAdded event", async () => {
      const indexer = createTestIndexer();
      await indexer.process({
        chains: {
          1: {
            simulate: [
              {
                contract: "ProtocolAdapter",
                event: "CommitmentTreeRootAdded",
                params: { root: "0x" + "ab".repeat(32) },
                block: { number: 100, timestamp: 0 },
                transaction: { hash: TX_HASH },
                logIndex: 0,
              },
            ],
          },
        },
      });

      const daily = await indexer.DailyStats.get(DEFAULT_DAY_KEY);
      expect(daily).toBeDefined();
      expect(daily!.commitmentRoots).toBe(1n);
    });
  });

  describe("counter isolation", () => {
    it("should only increment the relevant DailyStats counter for each event type", async () => {
      const indexer = createTestIndexer();
      await indexer.process({
        chains: {
          1: {
            simulate: [
              {
                contract: "ProtocolAdapter",
                event: "ResourcePayload",
                params: { tag: "0x" + "01".repeat(32), index: 0n, blob: "0x00" },
                block: { number: 100, timestamp: 0 },
                transaction: { hash: TX_HASH },
                logIndex: 0,
              },
              {
                contract: "ProtocolAdapter",
                event: "DiscoveryPayload",
                params: { tag: "0x" + "02".repeat(32), index: 0n, blob: "0x00" },
                block: { number: 100, timestamp: 0 },
                logIndex: 1,
              },
              {
                contract: "ProtocolAdapter",
                event: "ExternalPayload",
                params: { tag: "0x" + "03".repeat(32), index: 0n, blob: "0x00" },
                block: { number: 100, timestamp: 0 },
                logIndex: 2,
              },
              {
                contract: "ProtocolAdapter",
                event: "ApplicationPayload",
                params: { tag: "0x" + "04".repeat(32), index: 0n, blob: "0x00" },
                block: { number: 100, timestamp: 0 },
                logIndex: 3,
              },
              {
                contract: "ProtocolAdapter",
                event: "ForwarderCallExecuted",
                params: {
                  untrustedForwarder: FORWARDER,
                  input: "0xdeadbeef",
                  output: "0xcafebabe",
                },
                block: { number: 100, timestamp: 0 },
                transaction: { hash: TX_HASH },
                logIndex: 4,
              },
            ],
          },
        },
      });

      const daily = await indexer.DailyStats.get(DEFAULT_DAY_KEY);
      expect(daily).toBeDefined();
      expect(daily!.resourcePayloads).toBe(1n);
      expect(daily!.discoveryPayloads).toBe(1n);
      expect(daily!.externalCalls).toBe(1n);
      expect(daily!.applicationPayloads).toBe(1n);
      expect(daily!.forwarderCalls).toBe(1n);

      // Counters not touched should remain at 0
      expect(daily!.transactions).toBe(0n);
      expect(daily!.tags).toBe(0n);
      expect(daily!.actions).toBe(0n);
      expect(daily!.complianceUnits).toBe(0n);
      expect(daily!.logicInputs).toBe(0n);
    });
  });

  describe("both Stats and DailyStats are updated together", () => {
    it("should update both Stats and DailyStats on the same event", async () => {
      const indexer = createTestIndexer();
      await indexer.process({
        chains: {
          1: {
            simulate: [
              {
                contract: "ProtocolAdapter",
                event: "CommitmentTreeRootAdded",
                params: { root: "0x" + "ab".repeat(32) },
                block: { number: 100, timestamp: 0 },
                transaction: { hash: TX_HASH },
                logIndex: 0,
              },
            ],
          },
        },
      });

      // Global Stats
      const stats = await indexer.Stats.get("global");
      expect(stats).toBeDefined();
      expect(stats!.commitmentRoots).toBe(1n);

      // DailyStats
      const daily = await indexer.DailyStats.get(DEFAULT_DAY_KEY);
      expect(daily).toBeDefined();
      expect(daily!.commitmentRoots).toBe(1n);
    });
  });

  describe("initial state", () => {
    it("should initialize all DailyStats counters to zero except the incremented one", async () => {
      const indexer = createTestIndexer();
      await indexer.process({
        chains: {
          1: {
            simulate: [
              {
                contract: "ProtocolAdapter",
                event: "CommitmentTreeRootAdded",
                params: { root: "0x" + "ab".repeat(32) },
                block: { number: 100, timestamp: 0 },
                transaction: { hash: TX_HASH },
                logIndex: 0,
              },
            ],
          },
        },
      });

      const daily = await indexer.DailyStats.get(DEFAULT_DAY_KEY);
      expect(daily).toBeDefined();
      expect(daily!.externalCalls).toBe(0n);
      expect(daily!.forwarderCalls).toBe(0n);
      expect(daily!.resourcePayloads).toBe(0n);
      expect(daily!.discoveryPayloads).toBe(0n);
      expect(daily!.applicationPayloads).toBe(0n);
      expect(daily!.transactions).toBe(0n);
      expect(daily!.tags).toBe(0n);
      expect(daily!.actions).toBe(0n);
      expect(daily!.complianceUnits).toBe(0n);
      expect(daily!.logicInputs).toBe(0n);
      // But commitmentRoots should be 1
      expect(daily!.commitmentRoots).toBe(1n);
    });
  });
});
