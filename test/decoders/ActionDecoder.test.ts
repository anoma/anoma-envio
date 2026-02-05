import { expect } from "chai";
import {
  decodeExecuteCalldata,
  isExecuteCalldata,
  getActionFromCalldata,
} from "../../src/decoders/ActionDecoder";

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
});
