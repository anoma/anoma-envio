import { describe, it, expect } from "vitest";
import {
  decodeExecuteCalldata,
  isExecuteCalldata,
  getActionFromCalldata,
} from "../../src/decoders/ActionDecoder.js";
import { DeletionCriterion } from "../../src/types/index.js";
import {
  CALLDATA,
  EXTERNAL_PAYLOAD_TAG,
  EXTERNAL_PAYLOAD_BLOB,
} from "../fixtures/base-tx-0xdc958fa7.js";

describe("ActionDecoder", () => {
  describe("isExecuteCalldata", () => {
    it("should return false for empty input", () => {
      expect(isExecuteCalldata("")).toBe(false);
      expect(isExecuteCalldata("0x")).toBe(false);
    });

    it("should return false for non-execute function selectors", () => {
      expect(isExecuteCalldata("0x12345678")).toBe(false);
      expect(isExecuteCalldata("0xdeadbeef")).toBe(false);
    });

    it("should return true for execute function selector", () => {
      expect(isExecuteCalldata("0xed3cf91f")).toBe(true);
      expect(isExecuteCalldata("0xed3cf91f00000000")).toBe(true);
    });

    it("should require 0x prefix for input", () => {
      // The function checks for proper hex format starting with 0x
      expect(isExecuteCalldata("ed3cf91f")).toBe(false);
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
      const result = decodeExecuteCalldata("0xed3cf91f0000");
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
      expect(getActionFromCalldata("0xed3cf91f", -1)).toBeNull();
    });
  });

  // Real calldata from Base tx 0xdc958fa7... (pa-evm#474)
  // This tx has externalPayload.length=1 but no ExternalPayload event emitted.
  describe("real calldata: external payload extraction (pa-evm#474)", () => {
    it("should decode the transaction with 1 action and 2 logic inputs", () => {
      const result = decodeExecuteCalldata(CALLDATA);
      expect(result.success).toBe(true);
      if (!result.success) {
        return;
      }

      expect(result.transaction.actions).toHaveLength(1);
      expect(result.transaction.actions[0].logicVerifierInputs).toHaveLength(2);
      expect(result.transaction.actions[0].complianceVerifierInputs).toHaveLength(1);
    });

    it("should have 0 external payloads on LI[0] (consumed resource)", () => {
      const action = getActionFromCalldata(CALLDATA, 0);
      expect(action).not.toBeNull();
      if (!action) {
        return;
      }

      const li0 = action.logicVerifierInputs[0];
      expect(li0.appData.externalPayload).toHaveLength(0);
      expect(li0.appData.resourcePayload).toHaveLength(1);
      expect(li0.appData.discoveryPayload).toHaveLength(1);
    });

    it("should extract 1 external payload from LI[1] (created resource)", () => {
      const action = getActionFromCalldata(CALLDATA, 0);
      expect(action).not.toBeNull();
      if (!action) {
        return;
      }

      const li1 = action.logicVerifierInputs[1];
      expect(li1.appData.externalPayload).toHaveLength(1);
      expect(li1.appData.resourcePayload).toHaveLength(0);
      expect(li1.appData.discoveryPayload).toHaveLength(0);
    });

    it("should have correct tag, blob, and deletionCriterion on the external payload", () => {
      const action = getActionFromCalldata(CALLDATA, 0);
      expect(action).not.toBeNull();
      if (!action) {
        return;
      }

      const li1 = action.logicVerifierInputs[1];
      expect(li1.tag).toBe(EXTERNAL_PAYLOAD_TAG);

      const ep = li1.appData.externalPayload[0];
      expect(ep.deletionCriterion).toBe(DeletionCriterion.Immediately);
      expect(ep.blob).toBe(EXTERNAL_PAYLOAD_BLOB);
    });

    it("should have a blob containing the USDC forwarder address", () => {
      const action = getActionFromCalldata(CALLDATA, 0);
      expect(action).not.toBeNull();
      if (!action) {
        return;
      }

      const ep = action.logicVerifierInputs[1].appData.externalPayload[0];
      // The blob is ABI-encoded data containing the forwarder address and Base USDC
      const blobLower = ep.blob.toLowerCase();
      // ERC20 forwarder: 0xfaa9de773be11fc759a16f294d32bb2261bf818b
      expect(blobLower).toContain("faa9de773be11fc759a16f294d32bb2261bf818b");
      // Base USDC: 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
      expect(blobLower).toContain("833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    });
  });
});
