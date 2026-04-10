/**
 * AnomaPayERC20Forwarder Handler Tests
 *
 * Verifies that Wrapped and Unwrapped event handlers correctly create
 * entities and update aggregate stats.
 *
 * Uses Envio's MockDb + processEvent helpers for isolated unit testing.
 */

import { expect } from "chai";
import { TestHelpers } from "generated";

const { MockDb, AnomaPayERC20Forwarder } = TestHelpers;

const STATS_ID = "global";
const TOKEN = "0x" + "ab".repeat(20);
const USER = "0x" + "cd".repeat(20);

describe("AnomaPayERC20Forwarder Handlers", () => {
  describe("Wrapped", () => {
    it("should create an ERC20Wrap entity with correct fields", async () => {
      const mockDb = MockDb.createMockDb();
      const mockEvent = AnomaPayERC20Forwarder.Wrapped.createMockEvent({
        token: TOKEN,
        from: USER,
        amount: 1000n,
      });

      const result = await AnomaPayERC20Forwarder.Wrapped.processEvent({
        event: mockEvent,
        mockDb,
      });

      const id = `${mockEvent.chainId}_${mockEvent.transaction.hash}_${mockEvent.logIndex}`;
      const wrap = result.entities.ERC20Wrap.get(id);
      expect(wrap).to.not.be.undefined;
      expect(wrap!.token).to.equal(TOKEN);
      expect(wrap!.from).to.equal(USER);
      expect(wrap!.amount).to.equal(1000n);
    });

    it("should increment totalWraps and totalWrappedVolume in stats", async () => {
      const mockDb = MockDb.createMockDb();
      const mockEvent = AnomaPayERC20Forwarder.Wrapped.createMockEvent({
        token: TOKEN,
        from: USER,
        amount: 500n,
      });

      const result = await AnomaPayERC20Forwarder.Wrapped.processEvent({
        event: mockEvent,
        mockDb,
      });

      const stats = result.entities.AnomaPayERC20ForwarderStats.get(STATS_ID);
      expect(stats).to.not.be.undefined;
      expect(stats!.totalWraps).to.equal(1);
      expect(stats!.totalWrappedVolume).to.equal(500n);
      expect(stats!.totalUnwraps).to.equal(0);
      expect(stats!.totalUnwrappedVolume).to.equal(0n);
    });
  });

  describe("Unwrapped", () => {
    it("should create an ERC20Unwrap entity with correct fields", async () => {
      const mockDb = MockDb.createMockDb();
      const mockEvent = AnomaPayERC20Forwarder.Unwrapped.createMockEvent({
        token: TOKEN,
        to: USER,
        amount: 2000n,
      });

      const result = await AnomaPayERC20Forwarder.Unwrapped.processEvent({
        event: mockEvent,
        mockDb,
      });

      const id = `${mockEvent.chainId}_${mockEvent.transaction.hash}_${mockEvent.logIndex}`;
      const unwrap = result.entities.ERC20Unwrap.get(id);
      expect(unwrap).to.not.be.undefined;
      expect(unwrap!.token).to.equal(TOKEN);
      expect(unwrap!.to).to.equal(USER);
      expect(unwrap!.amount).to.equal(2000n);
    });

    it("should increment totalUnwraps and totalUnwrappedVolume in stats", async () => {
      const mockDb = MockDb.createMockDb();
      const mockEvent = AnomaPayERC20Forwarder.Unwrapped.createMockEvent({
        token: TOKEN,
        to: USER,
        amount: 750n,
      });

      const result = await AnomaPayERC20Forwarder.Unwrapped.processEvent({
        event: mockEvent,
        mockDb,
      });

      const stats = result.entities.AnomaPayERC20ForwarderStats.get(STATS_ID);
      expect(stats).to.not.be.undefined;
      expect(stats!.totalUnwraps).to.equal(1);
      expect(stats!.totalUnwrappedVolume).to.equal(750n);
      expect(stats!.totalWraps).to.equal(0);
      expect(stats!.totalWrappedVolume).to.equal(0n);
    });
  });

  describe("Stats accumulation", () => {
    it("should accumulate across multiple Wrapped and Unwrapped events", async () => {
      let db = MockDb.createMockDb();

      const wrap1 = AnomaPayERC20Forwarder.Wrapped.createMockEvent({
        token: TOKEN,
        from: USER,
        amount: 100n,
      });
      db = await AnomaPayERC20Forwarder.Wrapped.processEvent({ event: wrap1, mockDb: db });

      const wrap2 = AnomaPayERC20Forwarder.Wrapped.createMockEvent({
        token: TOKEN,
        from: USER,
        amount: 200n,
      });
      db = await AnomaPayERC20Forwarder.Wrapped.processEvent({ event: wrap2, mockDb: db });

      const unwrap1 = AnomaPayERC20Forwarder.Unwrapped.createMockEvent({
        token: TOKEN,
        to: USER,
        amount: 150n,
      });
      db = await AnomaPayERC20Forwarder.Unwrapped.processEvent({ event: unwrap1, mockDb: db });

      const stats = db.entities.AnomaPayERC20ForwarderStats.get(STATS_ID);
      expect(stats).to.not.be.undefined;
      expect(stats!.totalWraps).to.equal(2);
      expect(stats!.totalWrappedVolume).to.equal(300n);
      expect(stats!.totalUnwraps).to.equal(1);
      expect(stats!.totalUnwrappedVolume).to.equal(150n);
    });
  });
});
