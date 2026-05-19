/**
 * ChainStats / ChainDailyStats / ChainLogicRef Counter Tests
 *
 * Verifies that per-chain counter entities are populated alongside the
 * global Stats / DailyStats, with correct per-chain isolation.
 *
 * Refs anoma/anoma-explorer#139
 */

import { expect } from "chai";
import { TestHelpers } from "generated";

const { MockDb, ProtocolAdapter } = TestHelpers;

const STATS_ID = "global";
const CHAIN_A = 1;
const CHAIN_B = 8453;

// 2026-05-19 00:00 UTC — picked so all events land in the same UTC day.
const TIMESTAMP = 1779148800;
const DATE_KEY = "2026-05-19";

describe("ChainStats / ChainDailyStats Counters", () => {
  describe("single chain", () => {
    it("should increment ChainStats keyed by chainId", async () => {
      const mockDb = MockDb.createMockDb();
      const mockEvent = ProtocolAdapter.ResourcePayload.createMockEvent({
        tag: "0x" + "aa".repeat(32),
        index: 0n,
        blob: "0x00",
        mockEventData: {
          chainId: CHAIN_A,
          block: { number: 100, timestamp: TIMESTAMP },
        },
      });

      const result = await ProtocolAdapter.ResourcePayload.processEvent({
        event: mockEvent,
        mockDb,
      });

      const chainStats = result.entities.ChainStats.get(String(CHAIN_A));
      expect(chainStats, "ChainStats row missing").to.not.be.undefined;
      expect(chainStats!.chainId).to.equal(CHAIN_A);
      expect(chainStats!.resourcePayloads).to.equal(1);
      expect(chainStats!.discoveryPayloads).to.equal(0);
    });

    it("should increment ChainDailyStats keyed by '<chainId>-<date>'", async () => {
      const mockDb = MockDb.createMockDb();
      const mockEvent = ProtocolAdapter.ResourcePayload.createMockEvent({
        tag: "0x" + "aa".repeat(32),
        index: 0n,
        blob: "0x00",
        mockEventData: {
          chainId: CHAIN_A,
          block: { number: 100, timestamp: TIMESTAMP },
        },
      });

      const result = await ProtocolAdapter.ResourcePayload.processEvent({
        event: mockEvent,
        mockDb,
      });

      const chainDaily = result.entities.ChainDailyStats.get(`${CHAIN_A}-${DATE_KEY}`);
      expect(chainDaily, "ChainDailyStats row missing").to.not.be.undefined;
      expect(chainDaily!.chainId).to.equal(CHAIN_A);
      expect(chainDaily!.date).to.equal(DATE_KEY);
      expect(chainDaily!.resourcePayloads).to.equal(1);
    });
  });

  describe("multi-chain isolation", () => {
    it("should keep ChainStats counters separate per chain", async () => {
      let db = MockDb.createMockDb();

      const eventA = ProtocolAdapter.ResourcePayload.createMockEvent({
        tag: "0x" + "aa".repeat(32),
        index: 0n,
        blob: "0x00",
        mockEventData: {
          chainId: CHAIN_A,
          block: { number: 100, timestamp: TIMESTAMP },
        },
      });
      db = await ProtocolAdapter.ResourcePayload.processEvent({ event: eventA, mockDb: db });

      const eventB1 = ProtocolAdapter.ResourcePayload.createMockEvent({
        tag: "0x" + "bb".repeat(32),
        index: 0n,
        blob: "0x00",
        mockEventData: {
          chainId: CHAIN_B,
          block: { number: 200, timestamp: TIMESTAMP },
        },
      });
      db = await ProtocolAdapter.ResourcePayload.processEvent({ event: eventB1, mockDb: db });

      const eventB2 = ProtocolAdapter.ResourcePayload.createMockEvent({
        tag: "0x" + "cc".repeat(32),
        index: 1n,
        blob: "0x00",
        mockEventData: {
          chainId: CHAIN_B,
          block: { number: 201, timestamp: TIMESTAMP },
        },
      });
      db = await ProtocolAdapter.ResourcePayload.processEvent({ event: eventB2, mockDb: db });

      const statsA = db.entities.ChainStats.get(String(CHAIN_A));
      const statsB = db.entities.ChainStats.get(String(CHAIN_B));
      expect(statsA!.resourcePayloads).to.equal(1);
      expect(statsB!.resourcePayloads).to.equal(2);

      // Global Stats should equal the sum across chains.
      const global = db.entities.Stats.get(STATS_ID);
      expect(global!.resourcePayloads).to.equal(3);
    });

    it("should not create a ChainStats row for chains that saw no events", async () => {
      const mockDb = MockDb.createMockDb();
      const mockEvent = ProtocolAdapter.ResourcePayload.createMockEvent({
        tag: "0x" + "aa".repeat(32),
        index: 0n,
        blob: "0x00",
        mockEventData: {
          chainId: CHAIN_A,
          block: { number: 100, timestamp: TIMESTAMP },
        },
      });

      const result = await ProtocolAdapter.ResourcePayload.processEvent({
        event: mockEvent,
        mockDb,
      });

      expect(result.entities.ChainStats.get(String(CHAIN_B))).to.be.undefined;
    });
  });

  describe("ChainLogicRef distinct counting", () => {
    const TX_HASH_A = "0x" + "ab".repeat(32);
    const TX_HASH_B = "0x" + "cd".repeat(32);
    const TAGS = ["0x" + "11".repeat(32), "0x" + "12".repeat(32)];
    const SHARED_LOGIC = "0x" + "ff".repeat(32);
    const UNIQUE_LOGIC_B = "0x" + "ee".repeat(32);

    it("should count a verifyingKey once per chain even when shared across chains", async () => {
      let db = MockDb.createMockDb();

      // Chain A: one tx with logic ref SHARED_LOGIC used twice (so unique-set size 1).
      const eventA = ProtocolAdapter.TransactionExecuted.createMockEvent({
        tags: TAGS,
        logicRefs: [SHARED_LOGIC, SHARED_LOGIC],
        mockEventData: {
          chainId: CHAIN_A,
          block: { number: 100, timestamp: TIMESTAMP },
          transaction: { hash: TX_HASH_A },
        },
      });
      db = await ProtocolAdapter.TransactionExecuted.processEvent({ event: eventA, mockDb: db });

      // Chain B: one tx with SHARED_LOGIC (same key, different chain) + a new UNIQUE_LOGIC_B.
      const eventB = ProtocolAdapter.TransactionExecuted.createMockEvent({
        tags: TAGS,
        logicRefs: [SHARED_LOGIC, UNIQUE_LOGIC_B],
        mockEventData: {
          chainId: CHAIN_B,
          block: { number: 200, timestamp: TIMESTAMP },
          transaction: { hash: TX_HASH_B },
        },
      });
      db = await ProtocolAdapter.TransactionExecuted.processEvent({ event: eventB, mockDb: db });

      // Global: 2 distinct logics (SHARED_LOGIC, UNIQUE_LOGIC_B).
      const global = db.entities.Stats.get(STATS_ID);
      expect(global!.distinctLogics).to.equal(2);

      // Chain A: 1 distinct logic (SHARED_LOGIC).
      const statsA = db.entities.ChainStats.get(String(CHAIN_A));
      expect(statsA!.distinctLogics).to.equal(1);

      // Chain B: 2 distinct logics (SHARED_LOGIC seen first on B + UNIQUE_LOGIC_B).
      const statsB = db.entities.ChainStats.get(String(CHAIN_B));
      expect(statsB!.distinctLogics).to.equal(2);
    });

    it("should write ChainLogicRef rows keyed by '<chainId>-<verifyingKey>'", async () => {
      const mockDb = MockDb.createMockDb();
      const event = ProtocolAdapter.TransactionExecuted.createMockEvent({
        tags: TAGS,
        logicRefs: [SHARED_LOGIC, SHARED_LOGIC],
        mockEventData: {
          chainId: CHAIN_A,
          block: { number: 100, timestamp: TIMESTAMP },
          transaction: { hash: TX_HASH_A },
        },
      });

      const result = await ProtocolAdapter.TransactionExecuted.processEvent({
        event,
        mockDb,
      });

      const ref = result.entities.ChainLogicRef.get(`${CHAIN_A}-${SHARED_LOGIC}`);
      expect(ref, "ChainLogicRef row missing").to.not.be.undefined;
      expect(ref!.chainId).to.equal(CHAIN_A);
      expect(ref!.verifyingKey).to.equal(SHARED_LOGIC);
      expect(ref!.firstSeenTxHash).to.equal(TX_HASH_A);
    });
  });
});
