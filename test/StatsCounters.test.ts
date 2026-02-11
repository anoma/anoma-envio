/**
 * Stats Counter Tests
 *
 * Verifies that the new Stats counters (externalCalls, forwarderCalls,
 * resourcePayloads, discoveryPayloads, applicationPayloads) are properly
 * incremented by their respective event handlers.
 *
 * Uses Envio's MockDb + processEvent helpers for isolated unit testing.
 *
 * Refs #12
 */

import { expect } from "chai";
import { TestHelpers } from "generated";

const { MockDb, ProtocolAdapter } = TestHelpers;

const STATS_ID = "global";

describe("Stats Counters", () => {
  describe("resourcePayloads", () => {
    it("should increment resourcePayloads on ResourcePayload event", async () => {
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

      const stats = result.entities.Stats.get(STATS_ID);
      expect(stats).to.not.be.undefined;
      expect(stats!.resourcePayloads).to.equal(1);
    });

    it("should accumulate resourcePayloads across multiple events", async () => {
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

      const stats = db2.entities.Stats.get(STATS_ID);
      expect(stats).to.not.be.undefined;
      expect(stats!.resourcePayloads).to.equal(2);
    });
  });

  describe("discoveryPayloads", () => {
    it("should increment discoveryPayloads on DiscoveryPayload event", async () => {
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

      const stats = result.entities.Stats.get(STATS_ID);
      expect(stats).to.not.be.undefined;
      expect(stats!.discoveryPayloads).to.equal(1);
    });
  });

  describe("externalCalls", () => {
    it("should increment externalCalls on ExternalPayload event", async () => {
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

      const stats = result.entities.Stats.get(STATS_ID);
      expect(stats).to.not.be.undefined;
      expect(stats!.externalCalls).to.equal(1);
    });
  });

  describe("applicationPayloads", () => {
    it("should increment applicationPayloads on ApplicationPayload event", async () => {
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

      const stats = result.entities.Stats.get(STATS_ID);
      expect(stats).to.not.be.undefined;
      expect(stats!.applicationPayloads).to.equal(1);
    });
  });

  describe("forwarderCalls", () => {
    it("should increment forwarderCalls on ForwarderCallExecuted event", async () => {
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

      const stats = result.entities.Stats.get(STATS_ID);
      expect(stats).to.not.be.undefined;
      expect(stats!.forwarderCalls).to.equal(1);
    });
  });

  describe("counter isolation", () => {
    it("should only increment the relevant counter for each event type", async () => {
      let db = MockDb.createMockDb();

      // Process one of each event type
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

      const stats = db.entities.Stats.get(STATS_ID);
      expect(stats).to.not.be.undefined;
      expect(stats!.resourcePayloads).to.equal(1);
      expect(stats!.discoveryPayloads).to.equal(1);
      expect(stats!.externalCalls).to.equal(1);
      expect(stats!.applicationPayloads).to.equal(1);
      expect(stats!.forwarderCalls).to.equal(1);

      // Existing counters should remain at 0 (no TransactionExecuted/ActionExecuted processed)
      expect(stats!.transactions).to.equal(0);
      expect(stats!.tags).to.equal(0);
      expect(stats!.actions).to.equal(0);
      expect(stats!.complianceUnits).to.equal(0);
      expect(stats!.logicInputs).to.equal(0);
      expect(stats!.distinctLogics).to.equal(0);
    });
  });

  describe("initial state", () => {
    it("should initialize all new counters to zero", async () => {
      // Process a CommitmentTreeRootAdded event (doesn't touch any new counters)
      const mockDb = MockDb.createMockDb();
      const mockEvent = ProtocolAdapter.CommitmentTreeRootAdded.createMockEvent({
        root: "0x" + "ab".repeat(32),
      });

      const result = await ProtocolAdapter.CommitmentTreeRootAdded.processEvent({
        event: mockEvent,
        mockDb,
      });

      const stats = result.entities.Stats.get(STATS_ID);
      expect(stats).to.not.be.undefined;
      expect(stats!.externalCalls).to.equal(0);
      expect(stats!.forwarderCalls).to.equal(0);
      expect(stats!.resourcePayloads).to.equal(0);
      expect(stats!.discoveryPayloads).to.equal(0);
      expect(stats!.applicationPayloads).to.equal(0);
      // But commitmentRoots should be 1
      expect(stats!.commitmentRoots).to.equal(1);
    });
  });
});
