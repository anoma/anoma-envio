import { describe, it, expect } from "vitest";
import {
  decodeExecuteCalldata,
  isExecuteCalldata,
  getActionFromCalldata,
  EXECUTE_SELECTOR,
} from "../../src/decoders/ActionDecoder.js";
import { DeletionCriterion } from "../../src/types/index.js";
import { b32, blob, consumed, created, action, encodeExecute } from "../fixtures/encode-tx.js";

/**
 * The selector the compiler reports for pa-evm's `execute`, from
 * `forge inspect src/ProtocolAdapter.sol:ProtocolAdapter methodIdentifiers`.
 *
 * Because a selector hashes the whole nested tuple structure, pinning it is what makes the
 * synthetic round-trips below trustworthy: any field this decoder's ABI got wrong — a type, an
 * order, a missing member — changes the selector and fails here rather than round-tripping
 * happily through its own mistake.
 */
const PA_V2_EXECUTE_SELECTOR = "0x73ab9916";

/** The v1.1.0 selector, kept so a regression to the old struct shape is caught explicitly. */
const PA_V1_EXECUTE_SELECTOR = "0xed3cf91f";

describe("ActionDecoder", () => {
  describe("EXECUTE_SELECTOR", () => {
    it("should match the selector the contract compiles to", () => {
      expect(EXECUTE_SELECTOR).toBe(PA_V2_EXECUTE_SELECTOR);
    });
  });

  describe("isExecuteCalldata", () => {
    it("should return false for empty input", () => {
      expect(isExecuteCalldata("")).toBe(false);
      expect(isExecuteCalldata("0x")).toBe(false);
    });

    it("should return false for non-execute function selectors", () => {
      expect(isExecuteCalldata("0x12345678")).toBe(false);
      expect(isExecuteCalldata("0xdeadbeef")).toBe(false);
    });

    it("should return false for the v1 execute selector", () => {
      expect(isExecuteCalldata(PA_V1_EXECUTE_SELECTOR)).toBe(false);
    });

    it("should return true for execute function selector", () => {
      expect(isExecuteCalldata(PA_V2_EXECUTE_SELECTOR)).toBe(true);
      expect(isExecuteCalldata(`${PA_V2_EXECUTE_SELECTOR}00000000`)).toBe(true);
    });

    it("should require 0x prefix for input", () => {
      // The function checks for proper hex format starting with 0x
      expect(isExecuteCalldata(PA_V2_EXECUTE_SELECTOR.slice(2))).toBe(false);
    });
  });

  describe("decodeExecuteCalldata", () => {
    it("should return error for empty calldata", () => {
      const result = decodeExecuteCalldata("");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Empty calldata");
      }
    });

    it("should return error for unknown function selector", () => {
      const result = decodeExecuteCalldata("0x12345678");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Unknown function selector");
      }
    });

    it("should return error for malformed calldata", () => {
      // Valid selector but truncated/invalid data
      const result = decodeExecuteCalldata(`${PA_V2_EXECUTE_SELECTOR}0000`);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Failed to decode calldata");
      }
    });
  });

  describe("getActionFromCalldata", () => {
    it("should return null for invalid calldata", () => {
      expect(getActionFromCalldata("", 0)).toBeNull();
      expect(getActionFromCalldata("0x12345678", 0)).toBeNull();
    });

    it("should return null for invalid action index", () => {
      // Even with valid calldata, negative index should fail
      expect(getActionFromCalldata(PA_V2_EXECUTE_SELECTOR, -1)).toBeNull();
    });
  });

  describe("round-trip over the v2 struct shape", () => {
    const root = b32("root0");
    const calldata = encodeExecute([
      action(
        [consumed(b32("n0"), b32("logicA"), { resourcePayload: [blob("0xaa")] })],
        [
          created(b32("c0"), b32("logicB"), { externalPayload: [blob("0xbb")] }),
          created(b32("c1"), b32("logicA")),
        ],
        root,
        { x: 7n, y: 9n }
      ),
    ]);

    it("should decode an n:m action with its unit delta and action tree root", () => {
      const result = decodeExecuteCalldata(calldata);
      expect(result.success).toBe(true);
      if (!result.success) {
        return;
      }

      expect(result.transaction.actions).toHaveLength(1);
      const decoded = result.transaction.actions[0];
      expect(decoded.consumed).toHaveLength(1);
      expect(decoded.created).toHaveLength(2);
      expect(decoded.actionTreeRoot).toBe(root);
      expect(decoded.unitDelta).toEqual({ x: 7n, y: 9n });
    });

    it("should carry the logic reference and commitment tree root of a consumed resource", () => {
      const decoded = getActionFromCalldata(calldata, 0);
      expect(decoded).not.toBeNull();
      if (!decoded) {
        return;
      }

      expect(decoded.consumed[0].nullifier).toBe(b32("n0"));
      expect(decoded.consumed[0].logicRef).toBe(b32("logicA"));
      expect(decoded.consumed[0].commitmentTreeRoot).toBe(`0x${"00".repeat(32)}`);
    });

    it("should carry the app data payloads of each resource", () => {
      const decoded = getActionFromCalldata(calldata, 0);
      expect(decoded).not.toBeNull();
      if (!decoded) {
        return;
      }

      expect(decoded.consumed[0].appData.resourcePayload).toHaveLength(1);
      expect(decoded.consumed[0].appData.externalPayload).toHaveLength(0);

      const externalPayload = decoded.created[0].appData.externalPayload;
      expect(externalPayload).toHaveLength(1);
      expect(externalPayload[0].blob).toBe("0xbb");
      expect(externalPayload[0].deletionCriterion).toBe(DeletionCriterion.Immediately);

      expect(decoded.created[1].appData.applicationPayload).toHaveLength(0);
    });

    it("should preserve the deletion criterion of a persisted blob", () => {
      const persisted = encodeExecute([
        action(
          [],
          [
            created(b32("c0"), b32("logicA"), {
              applicationPayload: [blob("0xcc", DeletionCriterion.Never)],
            }),
          ]
        ),
      ]);

      const decoded = getActionFromCalldata(persisted, 0);
      expect(decoded).not.toBeNull();
      if (!decoded) {
        return;
      }

      expect(decoded.created[0].appData.applicationPayload[0].deletionCriterion).toBe(
        DeletionCriterion.Never
      );
    });
  });
});
