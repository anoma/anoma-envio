/**
 * DailyStats Counter Tests
 *
 * Verifies that every handler increments DailyStats counters in addition
 * to the global Stats singleton. Mirrors StatsCounters.test.ts patterns.
 *
 * Refs #7
 */

import { expect } from "chai";
import { TestHelpers } from "generated";

const { MockDb, ProtocolAdapter } = TestHelpers;

// Default mock-event block.timestamp is 0, which maps to "1970-01-01"
const DEFAULT_DAY_KEY = "1970-01-01";

describe("DailyStats Counters", () => {
  describe("resourcePayloads", () => {
    it("should increment DailyStats.resourcePayloads on ResourcePayload event", async () => {
      const mockDb = MockDb.createMockDb();
      const mockEvent = ProtocolAdapter.ResourcePayload.createMockEvent({
        tag: "0x" + "aa".repeat(32),
        index: 0n,
        blob: "0x00",
      });

      const result = await ProtocolAdapter.ResourcePayload.processEvent({
        event: mockEvent,
        mockDb,
      });

      const daily = result.entities.DailyStats.get(DEFAULT_DAY_KEY);
      expect(daily).to.not.be.undefined;
      expect(daily!.resourcePayloads).to.equal(1);
      expect(daily!.dayTimestamp).to.equal(0);
    });

    it("should accumulate DailyStats.resourcePayloads across multiple events", async () => {
      const mockDb = MockDb.createMockDb();

      const event1 = ProtocolAdapter.ResourcePayload.createMockEvent({
        tag: "0x" + "aa".repeat(32),
        index: 0n,
        blob: "0x00",
      });
      const db1 = await ProtocolAdapter.ResourcePayload.processEvent({
        event: event1,
        mockDb,
      });

      const event2 = ProtocolAdapter.ResourcePayload.createMockEvent({
        tag: "0x" + "bb".repeat(32),
        index: 1n,
        blob: "0x00",
      });
      const db2 = await ProtocolAdapter.ResourcePayload.processEvent({
        event: event2,
        mockDb: db1,
      });

      const daily = db2.entities.DailyStats.get(DEFAULT_DAY_KEY);
      expect(daily).to.not.be.undefined;
      expect(daily!.resourcePayloads).to.equal(2);
    });
  });

  describe("discoveryPayloads", () => {
    it("should increment DailyStats.discoveryPayloads on DiscoveryPayload event", async () => {
      const mockDb = MockDb.createMockDb();
      const mockEvent = ProtocolAdapter.DiscoveryPayload.createMockEvent({
        tag: "0x" + "cc".repeat(32),
        index: 0n,
        blob: "0x00",
      });

      const result = await ProtocolAdapter.DiscoveryPayload.processEvent({
        event: mockEvent,
        mockDb,
      });

      const daily = result.entities.DailyStats.get(DEFAULT_DAY_KEY);
      expect(daily).to.not.be.undefined;
      expect(daily!.discoveryPayloads).to.equal(1);
    });
  });

  describe("externalCalls", () => {
    it("should increment DailyStats.externalCalls on ExternalPayload event", async () => {
      const mockDb = MockDb.createMockDb();
      const mockEvent = ProtocolAdapter.ExternalPayload.createMockEvent({
        tag: "0x" + "dd".repeat(32),
        index: 0n,
        blob: "0x00",
      });

      const result = await ProtocolAdapter.ExternalPayload.processEvent({
        event: mockEvent,
        mockDb,
      });

      const daily = result.entities.DailyStats.get(DEFAULT_DAY_KEY);
      expect(daily).to.not.be.undefined;
      expect(daily!.externalCalls).to.equal(1);
    });
  });

  describe("applicationPayloads", () => {
    it("should increment DailyStats.applicationPayloads on ApplicationPayload event", async () => {
      const mockDb = MockDb.createMockDb();
      const mockEvent = ProtocolAdapter.ApplicationPayload.createMockEvent({
        tag: "0x" + "ee".repeat(32),
        index: 0n,
        blob: "0x00",
      });

      const result = await ProtocolAdapter.ApplicationPayload.processEvent({
        event: mockEvent,
        mockDb,
      });

      const daily = result.entities.DailyStats.get(DEFAULT_DAY_KEY);
      expect(daily).to.not.be.undefined;
      expect(daily!.applicationPayloads).to.equal(1);
    });
  });

  describe("forwarderCalls", () => {
    it("should increment DailyStats.forwarderCalls on ForwarderCallExecuted event", async () => {
      const mockDb = MockDb.createMockDb();
      const mockEvent = ProtocolAdapter.ForwarderCallExecuted.createMockEvent({
        untrustedForwarder: "0x" + "ff".repeat(20),
        input: "0xdeadbeef",
        output: "0xcafebabe",
      });

      const result = await ProtocolAdapter.ForwarderCallExecuted.processEvent({
        event: mockEvent,
        mockDb,
      });

      const daily = result.entities.DailyStats.get(DEFAULT_DAY_KEY);
      expect(daily).to.not.be.undefined;
      expect(daily!.forwarderCalls).to.equal(1);
    });
  });

  describe("commitmentRoots", () => {
    it("should increment DailyStats.commitmentRoots on CommitmentTreeRootAdded event", async () => {
      const mockDb = MockDb.createMockDb();
      const mockEvent = ProtocolAdapter.CommitmentTreeRootAdded.createMockEvent({
        root: "0x" + "ab".repeat(32),
      });

      const result = await ProtocolAdapter.CommitmentTreeRootAdded.processEvent({
        event: mockEvent,
        mockDb,
      });

      const daily = result.entities.DailyStats.get(DEFAULT_DAY_KEY);
      expect(daily).to.not.be.undefined;
      expect(daily!.commitmentRoots).to.equal(1);
    });
  });

  describe("counter isolation", () => {
    it("should only increment the relevant DailyStats counter for each event type", async () => {
      let db = MockDb.createMockDb();

      const resourceEvent = ProtocolAdapter.ResourcePayload.createMockEvent({
        tag: "0x" + "01".repeat(32),
        index: 0n,
        blob: "0x00",
      });
      db = await ProtocolAdapter.ResourcePayload.processEvent({ event: resourceEvent, mockDb: db });

      const discoveryEvent = ProtocolAdapter.DiscoveryPayload.createMockEvent({
        tag: "0x" + "02".repeat(32),
        index: 0n,
        blob: "0x00",
      });
      db = await ProtocolAdapter.DiscoveryPayload.processEvent({
        event: discoveryEvent,
        mockDb: db,
      });

      const externalEvent = ProtocolAdapter.ExternalPayload.createMockEvent({
        tag: "0x" + "03".repeat(32),
        index: 0n,
        blob: "0x00",
      });
      db = await ProtocolAdapter.ExternalPayload.processEvent({
        event: externalEvent,
        mockDb: db,
      });

      const applicationEvent = ProtocolAdapter.ApplicationPayload.createMockEvent({
        tag: "0x" + "04".repeat(32),
        index: 0n,
        blob: "0x00",
      });
      db = await ProtocolAdapter.ApplicationPayload.processEvent({
        event: applicationEvent,
        mockDb: db,
      });

      const forwarderEvent = ProtocolAdapter.ForwarderCallExecuted.createMockEvent({
        untrustedForwarder: "0x" + "ff".repeat(20),
        input: "0xdeadbeef",
        output: "0xcafebabe",
      });
      db = await ProtocolAdapter.ForwarderCallExecuted.processEvent({
        event: forwarderEvent,
        mockDb: db,
      });

      const daily = db.entities.DailyStats.get(DEFAULT_DAY_KEY);
      expect(daily).to.not.be.undefined;
      expect(daily!.resourcePayloads).to.equal(1);
      expect(daily!.discoveryPayloads).to.equal(1);
      expect(daily!.externalCalls).to.equal(1);
      expect(daily!.applicationPayloads).to.equal(1);
      expect(daily!.forwarderCalls).to.equal(1);

      // Counters not touched should remain at 0
      expect(daily!.transactions).to.equal(0);
      expect(daily!.tags).to.equal(0);
      expect(daily!.actions).to.equal(0);
      expect(daily!.complianceUnits).to.equal(0);
      expect(daily!.logicInputs).to.equal(0);
    });
  });

  describe("both Stats and DailyStats are updated together", () => {
    it("should update both Stats and DailyStats on the same event", async () => {
      const mockDb = MockDb.createMockDb();
      const mockEvent = ProtocolAdapter.CommitmentTreeRootAdded.createMockEvent({
        root: "0x" + "ab".repeat(32),
      });

      const result = await ProtocolAdapter.CommitmentTreeRootAdded.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Global Stats
      const stats = result.entities.Stats.get("global");
      expect(stats).to.not.be.undefined;
      expect(stats!.commitmentRoots).to.equal(1);

      // DailyStats
      const daily = result.entities.DailyStats.get(DEFAULT_DAY_KEY);
      expect(daily).to.not.be.undefined;
      expect(daily!.commitmentRoots).to.equal(1);
    });
  });

  describe("initial state", () => {
    it("should initialize all DailyStats counters to zero except the incremented one", async () => {
      const mockDb = MockDb.createMockDb();
      const mockEvent = ProtocolAdapter.CommitmentTreeRootAdded.createMockEvent({
        root: "0x" + "ab".repeat(32),
      });

      const result = await ProtocolAdapter.CommitmentTreeRootAdded.processEvent({
        event: mockEvent,
        mockDb,
      });

      const daily = result.entities.DailyStats.get(DEFAULT_DAY_KEY);
      expect(daily).to.not.be.undefined;
      expect(daily!.externalCalls).to.equal(0);
      expect(daily!.forwarderCalls).to.equal(0);
      expect(daily!.resourcePayloads).to.equal(0);
      expect(daily!.discoveryPayloads).to.equal(0);
      expect(daily!.applicationPayloads).to.equal(0);
      expect(daily!.transactions).to.equal(0);
      expect(daily!.tags).to.equal(0);
      expect(daily!.actions).to.equal(0);
      expect(daily!.complianceUnits).to.equal(0);
      expect(daily!.logicInputs).to.equal(0);
      // But commitmentRoots should be 1
      expect(daily!.commitmentRoots).to.equal(1);
    });
  });
});
