/**
 * Resource type definitions following Anoma specification.
 *
 * A Resource represents a unit of value or data in the Anoma protocol.
 */

export interface Resource {
  logicRef: `0x${string}`;
  labelRef: `0x${string}`;
  valueRef: `0x${string}`;
  nullifierKeyCommitment: `0x${string}`;
  nonce: `0x${string}`;
  randSeed: `0x${string}`;
  quantity: bigint;
  ephemeral: boolean;
}

export interface DecodedResource {
  resource: Partial<Resource> | null;
  status: "success" | "failed" | "pending" | "raw";
  error?: string;
}

export interface ResourcePayloadEvent {
  tag: `0x${string}`;
  index: bigint;
  blob: `0x${string}`;
}
