import { expect } from "chai";
import { safeDecodeResourceBlob } from "../../src/decoders/ResourceDecoder";

describe("ResourceDecoder", () => {
  describe("safeDecodeResourceBlob", () => {
    it("should handle empty or null blobs", () => {
      const result1 = safeDecodeResourceBlob("");
      expect(result1.status).to.equal("pending");
      expect(result1.resource).to.be.null;

      // @ts-expect-error Testing null input handling
      const result2 = safeDecodeResourceBlob(null);
      expect(result2.status).to.equal("pending");
    });

    it("should handle invalid hex strings", () => {
      const result = safeDecodeResourceBlob("not-a-hex-string");
      expect(result.status).to.equal("failed");
      expect(result.error).to.include("Invalid hex format");
    });

    it("should detect EIP-712 format", () => {
      const blob = "0x1901" + "0".repeat(60);
      const result = safeDecodeResourceBlob(blob);
      expect(result.status).to.equal("raw");
      expect(result.error).to.include("eip712 format");
    });

    it("should detect EIP-191 format", () => {
      const blob = "0x19" + "0".repeat(60);
      const result = safeDecodeResourceBlob(blob);
      expect(result.status).to.equal("raw");
      expect(result.error).to.include("eip191 format");
    });

    it("should handle unknown format", () => {
      const blob = "0x1234" + "0".repeat(60);
      const result = safeDecodeResourceBlob(blob);
      expect(result.status).to.equal("raw");
      expect(result.error).to.include("unknown format");
    });

    it("should normalize blobs without 0x prefix", () => {
      const blob = "1901" + "0".repeat(60);
      const result = safeDecodeResourceBlob(blob);
      expect(result.status).to.equal("raw");
      expect(result.error).to.include("eip712 format");
    });
  });
});
