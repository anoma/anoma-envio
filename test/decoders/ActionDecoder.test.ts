import { expect } from "chai";
import {
  decodeExecuteCalldata,
  isExecuteCalldata,
  getActionFromCalldata,
} from "../../src/decoders/ActionDecoder";
import { DeletionCriterion } from "../../src/types";
import {
  CALLDATA,
  EXTERNAL_PAYLOAD_TAG,
  EXTERNAL_PAYLOAD_BLOB,
} from "../fixtures/base-tx-0xdc958fa7";

describe("ActionDecoder", () => {
  describe("isExecuteCalldata", () => {
    it("should return false for empty input", () => {
      expect(isExecuteCalldata("")).to.be.false;
      expect(isExecuteCalldata("0x")).to.be.false;
    });

    it("should return false for non-execute function selectors", () => {
      expect(isExecuteCalldata("0x12345678")).to.be.false;
      expect(isExecuteCalldata("0xdeadbeef")).to.be.false;
    });

    it("should return true for execute function selector", () => {
      expect(isExecuteCalldata("0xed3cf91f")).to.be.true;
      expect(isExecuteCalldata("0xed3cf91f00000000")).to.be.true;
    });

    it("should require 0x prefix for input", () => {
      // The function checks for proper hex format starting with 0x
      expect(isExecuteCalldata("ed3cf91f")).to.be.false;
    });
  });

  describe("decodeExecuteCalldata", () => {
    it("should return error for empty calldata", () => {
      const result = decodeExecuteCalldata("");
      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.error).to.equal("Empty calldata");
      }
    });

    it("should return error for unknown function selector", () => {
      const result = decodeExecuteCalldata("0x12345678");
      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.error).to.include("Unknown function selector");
      }
    });

    it("should return error for malformed calldata", () => {
      // Valid selector but truncated/invalid data
      const result = decodeExecuteCalldata("0xed3cf91f0000");
      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.error).to.include("Failed to decode calldata");
      }
    });
  });

  describe("getActionFromCalldata", () => {
    it("should return null for invalid calldata", () => {
      expect(getActionFromCalldata("", 0)).to.be.null;
      expect(getActionFromCalldata("0x12345678", 0)).to.be.null;
    });

    it("should return null for invalid action index", () => {
      // Even with valid calldata, negative index should fail
      expect(getActionFromCalldata("0xed3cf91f", -1)).to.be.null;
    });
  });

  // Real calldata from Base tx 0xdc958fa7... (pa-evm#474)
  // This tx has externalPayload.length=1 but no ExternalPayload event emitted.
  describe("real calldata: external payload extraction (pa-evm#474)", () => {
    it("should decode the transaction with 1 action and 2 logic inputs", () => {
      const result = decodeExecuteCalldata(CALLDATA);
      expect(result.success).to.be.true;
      if (!result.success) {
        return;
      }

      expect(result.transaction.actions).to.have.length(1);
      expect(result.transaction.actions[0].logicVerifierInputs).to.have.length(2);
      expect(result.transaction.actions[0].complianceVerifierInputs).to.have.length(1);
    });

    it("should have 0 external payloads on LI[0] (consumed resource)", () => {
      const action = getActionFromCalldata(CALLDATA, 0);
      expect(action).to.not.be.null;
      if (!action) {
        return;
      }

      const li0 = action.logicVerifierInputs[0];
      expect(li0.appData.externalPayload).to.have.length(0);
      expect(li0.appData.resourcePayload).to.have.length(1);
      expect(li0.appData.discoveryPayload).to.have.length(1);
    });

    it("should extract 1 external payload from LI[1] (created resource)", () => {
      const action = getActionFromCalldata(CALLDATA, 0);
      expect(action).to.not.be.null;
      if (!action) {
        return;
      }

      const li1 = action.logicVerifierInputs[1];
      expect(li1.appData.externalPayload).to.have.length(1);
      expect(li1.appData.resourcePayload).to.have.length(0);
      expect(li1.appData.discoveryPayload).to.have.length(0);
    });

    it("should have correct tag, blob, and deletionCriterion on the external payload", () => {
      const action = getActionFromCalldata(CALLDATA, 0);
      expect(action).to.not.be.null;
      if (!action) {
        return;
      }

      const li1 = action.logicVerifierInputs[1];
      expect(li1.tag).to.equal(EXTERNAL_PAYLOAD_TAG);

      const ep = li1.appData.externalPayload[0];
      expect(ep.deletionCriterion).to.equal(DeletionCriterion.Immediately);
      expect(ep.blob).to.equal(EXTERNAL_PAYLOAD_BLOB);
    });

    it("should have a blob containing the USDC forwarder address", () => {
      const action = getActionFromCalldata(CALLDATA, 0);
      expect(action).to.not.be.null;
      if (!action) {
        return;
      }

      const ep = action.logicVerifierInputs[1].appData.externalPayload[0];
      // The blob is ABI-encoded data containing the forwarder address and Base USDC
      const blobLower = ep.blob.toLowerCase();
      // ERC20 forwarder: 0xfaa9de773be11fc759a16f294d32bb2261bf818b
      expect(blobLower).to.include("faa9de773be11fc759a16f294d32bb2261bf818b");
      // Base USDC: 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
      expect(blobLower).to.include("833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    });
  });
});
