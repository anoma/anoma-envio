/**
 * Stats Counter Tests
 *
 * Verifies that the new Stats counters (externalCalls, forwarderCalls,
 * resourcePayloads, discoveryPayloads, applicationPayloads) are properly
 * incremented by their respective event handlers.
 *
 * Refs #12
 */

import { describe, it, expect } from "vitest";
import { createTestIndexer } from "envio";

const STATS_ID = "global";

// Default TX hash used in tests — must be a 32-byte hex string
const TX_HASH = "0xabababababababababababababababababababababababababababababababababab";
// Default forwarder address (20-byte hex)
const FORWARDER = "0xffffffffffffffffffffffffffffffffffffffff";

describe("Stats Counters", () => {
  describe("resourcePayloads", () => {
    it("should increment resourcePayloads on ResourcePayload event", async () => {
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

      const stats = await indexer.Stats.getOrThrow(STATS_ID);
      expect(stats.resourcePayloads).toBe(1);
    });

    it("should accumulate resourcePayloads across multiple events", async () => {
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

      const stats = await indexer.Stats.getOrThrow(STATS_ID);
      expect(stats.resourcePayloads).toBe(2);
    });
  });

  describe("discoveryPayloads", () => {
    it("should increment discoveryPayloads on DiscoveryPayload event", async () => {
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

      const stats = await indexer.Stats.getOrThrow(STATS_ID);
      expect(stats.discoveryPayloads).toBe(1);
    });
  });

  describe("externalCalls", () => {
    it("should increment externalCalls on ExternalPayload event", async () => {
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

      const stats = await indexer.Stats.getOrThrow(STATS_ID);
      expect(stats.externalCalls).toBe(1);
    });
  });

  describe("applicationPayloads", () => {
    it("should increment applicationPayloads on ApplicationPayload event", async () => {
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

      const stats = await indexer.Stats.getOrThrow(STATS_ID);
      expect(stats.applicationPayloads).toBe(1);
    });
  });

  describe("forwarderCalls", () => {
    it("should increment forwarderCalls on ForwarderCallExecuted event", async () => {
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

      const stats = await indexer.Stats.getOrThrow(STATS_ID);
      expect(stats.forwarderCalls).toBe(1);
    });
  });

  describe("counter isolation", () => {
    it("should only increment the relevant counter for each event type", async () => {
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

      const stats = await indexer.Stats.getOrThrow(STATS_ID);
      expect(stats.resourcePayloads).toBe(1);
      expect(stats.discoveryPayloads).toBe(1);
      expect(stats.externalCalls).toBe(1);
      expect(stats.applicationPayloads).toBe(1);
      expect(stats.forwarderCalls).toBe(1);

      // Existing counters should remain at 0 (no TransactionExecuted/ActionExecuted processed)
      expect(stats.transactions).toBe(0);
      expect(stats.tags).toBe(0);
      expect(stats.actions).toBe(0);
      expect(stats.complianceUnits).toBe(0);
      expect(stats.logicInputs).toBe(0);
      expect(stats.distinctLogics).toBe(0);
    });
  });

  describe("initial state", () => {
    it("should initialize all new counters to zero", async () => {
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

      const stats = await indexer.Stats.getOrThrow(STATS_ID);
      expect(stats.externalCalls).toBe(0);
      expect(stats.forwarderCalls).toBe(0);
      expect(stats.resourcePayloads).toBe(0);
      expect(stats.discoveryPayloads).toBe(0);
      expect(stats.applicationPayloads).toBe(0);
      // But commitmentRoots should be 1
      expect(stats.commitmentRoots).toBe(1);
    });
  });
});
