/**
 * Decoder for Resource blobs from ResourcePayload events.
 *
 * IMPORTANT: The ResourcePayload blob is application-specific data, NOT a serialized
 * Resource struct. The Resource struct is embedded in the transaction calldata.
 * This decoder attempts to extract useful information from the blob but may not
 * always succeed as the format is application-dependent.
 */

import { DecodedResource } from "../types/Resource";

/**
 * Detects the blob format based on prefix bytes.
 */
function detectBlobFormat(blob: string): string {
  if (blob.startsWith("0x1901")) {
    return "eip712"; // EIP-712 structured data
  }
  if (blob.startsWith("0x19")) {
    return "eip191"; // EIP-191 signed data
  }
  return "unknown";
}

/**
 * Safely decodes a Resource blob with input validation.
 *
 * The ResourcePayload blob contains application-specific data that accompanies
 * a resource. This is NOT the Resource struct itself - that data is in the
 * transaction calldata. We store the raw blob and mark format detection status.
 *
 * @param blob - The blob string (with or without 0x prefix)
 * @returns DecodedResource with status and format info
 */
export function safeDecodeResourceBlob(blob: string): DecodedResource {
  // Handle empty or missing blobs
  if (!blob || blob === "" || blob === "0x") {
    return {
      resource: null,
      status: "pending",
      error: undefined,
    };
  }

  // Ensure blob has 0x prefix
  const normalizedBlob = blob.startsWith("0x") ? blob : `0x${blob}`;

  // Validate hex format
  if (!/^0x[0-9a-fA-F]*$/.test(normalizedBlob)) {
    return {
      resource: null,
      status: "failed",
      error: "Invalid hex format",
    };
  }

  // Detect the format
  const format = detectBlobFormat(normalizedBlob);

  // For now, we store the raw blob but don't decode it since the format
  // is application-specific. The blob data can be analyzed externally.
  // Mark as "raw" to indicate we have data but couldn't decode structured fields.
  return {
    resource: null,
    status: "raw",
    error: `Application-specific blob (${format} format, ${normalizedBlob.length - 2} hex chars)`,
  };
}
