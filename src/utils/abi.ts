/**
 * ABI definitions for decoding PA-EVM event data.
 *
 * These ABIs match the Solidity struct definitions in pa-evm/contracts/src/Types.sol
 */

/**
 * Compliance.Instance struct ABI
 *
 * struct Instance {
 *   ConsumedRefs consumed;
 *   CreatedRefs created;
 *   bytes32 unitDeltaX;
 *   bytes32 unitDeltaY;
 * }
 */
export const COMPLIANCE_INSTANCE_ABI = [
  {
    type: "tuple",
    components: [
      {
        name: "consumed",
        type: "tuple",
        components: [
          { name: "nullifier", type: "bytes32" },
          { name: "logicRef", type: "bytes32" },
          { name: "commitmentTreeRoot", type: "bytes32" },
        ],
      },
      {
        name: "created",
        type: "tuple",
        components: [
          { name: "commitment", type: "bytes32" },
          { name: "logicRef", type: "bytes32" },
        ],
      },
      { name: "unitDeltaX", type: "bytes32" },
      { name: "unitDeltaY", type: "bytes32" },
    ],
  },
] as const;

/**
 * ExpirableBlob struct ABI
 *
 * struct ExpirableBlob {
 *   DeletionCriterion deletionCriterion;
 *   bytes blob;
 * }
 */
export const EXPIRABLE_BLOB_ABI = [
  {
    type: "tuple",
    components: [
      { name: "deletionCriterion", type: "uint8" },
      { name: "blob", type: "bytes" },
    ],
  },
] as const;

/**
 * AppData struct ABI (partial - for counting payloads)
 */
export const APP_DATA_ABI = [
  {
    type: "tuple",
    components: [
      {
        name: "resourcePayload",
        type: "tuple[]",
        components: [
          { name: "deletionCriterion", type: "uint8" },
          { name: "blob", type: "bytes" },
        ],
      },
      {
        name: "discoveryPayload",
        type: "tuple[]",
        components: [
          { name: "deletionCriterion", type: "uint8" },
          { name: "blob", type: "bytes" },
        ],
      },
      {
        name: "externalPayload",
        type: "tuple[]",
        components: [
          { name: "deletionCriterion", type: "uint8" },
          { name: "blob", type: "bytes" },
        ],
      },
      {
        name: "applicationPayload",
        type: "tuple[]",
        components: [
          { name: "deletionCriterion", type: "uint8" },
          { name: "blob", type: "bytes" },
        ],
      },
    ],
  },
] as const;
