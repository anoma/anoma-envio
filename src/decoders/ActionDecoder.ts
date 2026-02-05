/**
 * Decoder for ProtocolAdapter.execute() transaction calldata.
 *
 * This decoder extracts the full Transaction structure from calldata,
 * including Actions with their ComplianceVerifierInputs and LogicVerifierInputs.
 *
 * The execute function signature is:
 * execute(Transaction calldata transaction)
 *
 * Where Transaction is:
 * struct Transaction {
 *     Action[] actions;
 *     bytes deltaProof;
 *     bytes aggregationProof;
 * }
 *
 * And Action is:
 * struct Action {
 *     Logic.VerifierInput[] logicVerifierInputs;
 *     Compliance.VerifierInput[] complianceVerifierInputs;
 * }
 */

import { decodeFunctionData, type Hex, type Abi } from "viem";
import { EXECUTE_SELECTOR } from "../constants";
import {
  Transaction,
  Action,
  LogicVerifierInput,
  ComplianceVerifierInput,
  AppData,
  ExpirableBlob,
  DeletionCriterion,
} from "../types";

// ABI for the execute function with nested structs
// Based on the full signature from the contract:
// execute((((bytes32,bytes32,((uint8,bytes)[],(uint8,bytes)[],(uint8,bytes)[],(uint8,bytes)[]),bytes)[],(bytes,((bytes32,bytes32,bytes32),(bytes32,bytes32),bytes32,bytes32))[])[],bytes,bytes))
const EXECUTE_ABI: Abi = [
  {
    name: "execute",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "transaction",
        type: "tuple",
        components: [
          {
            name: "actions",
            type: "tuple[]",
            components: [
              {
                name: "logicVerifierInputs",
                type: "tuple[]",
                components: [
                  { name: "tag", type: "bytes32" },
                  { name: "verifyingKey", type: "bytes32" },
                  {
                    name: "appData",
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
                  { name: "proof", type: "bytes" },
                ],
              },
              {
                name: "complianceVerifierInputs",
                type: "tuple[]",
                components: [
                  { name: "proof", type: "bytes" },
                  {
                    name: "instance",
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
                ],
              },
            ],
          },
          { name: "deltaProof", type: "bytes" },
          { name: "aggregationProof", type: "bytes" },
        ],
      },
    ],
    outputs: [],
  },
];

// Raw decoded types from viem
interface RawExpirableBlob {
  deletionCriterion: number;
  blob: Hex;
}

interface RawAppData {
  resourcePayload: readonly RawExpirableBlob[];
  discoveryPayload: readonly RawExpirableBlob[];
  externalPayload: readonly RawExpirableBlob[];
  applicationPayload: readonly RawExpirableBlob[];
}

interface RawLogicInput {
  tag: Hex;
  verifyingKey: Hex;
  appData: RawAppData;
  proof: Hex;
}

interface RawConsumedRefs {
  nullifier: Hex;
  logicRef: Hex;
  commitmentTreeRoot: Hex;
}

interface RawCreatedRefs {
  commitment: Hex;
  logicRef: Hex;
}

interface RawComplianceInstance {
  consumed: RawConsumedRefs;
  created: RawCreatedRefs;
  unitDeltaX: Hex;
  unitDeltaY: Hex;
}

interface RawComplianceInput {
  proof: Hex;
  instance: RawComplianceInstance;
}

interface RawAction {
  logicVerifierInputs: readonly RawLogicInput[];
  complianceVerifierInputs: readonly RawComplianceInput[];
}

interface RawTransaction {
  actions: readonly RawAction[];
  deltaProof: Hex;
  aggregationProof: Hex;
}

export interface DecodedTransactionResult {
  transaction: Transaction;
  success: true;
}

export interface DecodedTransactionError {
  success: false;
  error: string;
}

export type DecodedTransactionResponse = DecodedTransactionResult | DecodedTransactionError;

/**
 * Convert raw expirable blob from ABI decoding to typed format
 */
function convertExpirableBlob(raw: RawExpirableBlob): ExpirableBlob {
  return {
    deletionCriterion:
      raw.deletionCriterion === 0 ? DeletionCriterion.Immediately : DeletionCriterion.Never,
    blob: raw.blob,
  };
}

/**
 * Convert raw app data from ABI decoding to typed format
 */
function convertAppData(raw: RawAppData): AppData {
  return {
    resourcePayload: raw.resourcePayload.map(convertExpirableBlob),
    discoveryPayload: raw.discoveryPayload.map(convertExpirableBlob),
    externalPayload: raw.externalPayload.map(convertExpirableBlob),
    applicationPayload: raw.applicationPayload.map(convertExpirableBlob),
  };
}

/**
 * Convert raw logic verifier input from ABI decoding to typed format
 */
function convertLogicInput(raw: RawLogicInput): LogicVerifierInput {
  return {
    tag: raw.tag,
    verifyingKey: raw.verifyingKey,
    appData: convertAppData(raw.appData),
    proof: raw.proof,
  };
}

/**
 * Convert raw compliance verifier input from ABI decoding to typed format
 */
function convertComplianceInput(raw: RawComplianceInput): ComplianceVerifierInput {
  return {
    proof: raw.proof,
    instance: {
      consumed: {
        nullifier: raw.instance.consumed.nullifier,
        logicRef: raw.instance.consumed.logicRef,
        commitmentTreeRoot: raw.instance.consumed.commitmentTreeRoot,
      },
      created: {
        commitment: raw.instance.created.commitment,
        logicRef: raw.instance.created.logicRef,
      },
      unitDeltaX: raw.instance.unitDeltaX,
      unitDeltaY: raw.instance.unitDeltaY,
    },
  };
}

/**
 * Convert raw action from ABI decoding to typed format
 */
function convertAction(raw: RawAction): Action {
  return {
    logicVerifierInputs: raw.logicVerifierInputs.map(convertLogicInput),
    complianceVerifierInputs: raw.complianceVerifierInputs.map(convertComplianceInput),
  };
}

/**
 * Convert raw transaction from ABI decoding to typed format
 */
function convertTransaction(raw: RawTransaction): Transaction {
  return {
    actions: raw.actions.map(convertAction),
    deltaProof: raw.deltaProof,
    aggregationProof: raw.aggregationProof,
  };
}

/**
 * Decode transaction calldata from a ProtocolAdapter.execute() call.
 *
 * @param input - The transaction input/calldata as a hex string
 * @returns Decoded Transaction or error
 */
export function decodeExecuteCalldata(input: string): DecodedTransactionResponse {
  try {
    // Validate input
    if (!input || input === "0x") {
      return { success: false, error: "Empty calldata" };
    }

    const hexInput: Hex = input.startsWith("0x") ? (input as Hex) : `0x${input}`;

    // Check function selector
    const selector = hexInput.slice(0, 10).toLowerCase();
    if (selector !== EXECUTE_SELECTOR) {
      return {
        success: false,
        error: `Unknown function selector: ${selector}, expected ${EXECUTE_SELECTOR}`,
      };
    }

    // Decode the function data
    const decoded = decodeFunctionData({
      abi: EXECUTE_ABI,
      data: hexInput,
    });

    if (decoded.functionName !== "execute") {
      return {
        success: false,
        error: `Unexpected function name: ${decoded.functionName}`,
      };
    }

    // Extract the transaction argument (first and only argument)
    if (!decoded.args || decoded.args.length === 0) {
      return { success: false, error: "No arguments in decoded calldata" };
    }
    const rawTransaction = decoded.args[0] as RawTransaction;

    // Convert to typed format
    const transaction = convertTransaction(rawTransaction);

    return { success: true, transaction };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to decode calldata: ${message}` };
  }
}

/**
 * Check if calldata is for the execute function.
 */
export function isExecuteCalldata(input: string): boolean {
  if (!input || input.length < 10) {
    return false;
  }
  const hexInput = input.startsWith("0x") ? input : `0x${input}`;
  return hexInput.slice(0, 10).toLowerCase() === EXECUTE_SELECTOR;
}

/**
 * Get action at a specific index from decoded calldata.
 * Returns null if calldata cannot be decoded or index is out of bounds.
 */
export function getActionFromCalldata(input: string, actionIndex: number): Action | null {
  const result = decodeExecuteCalldata(input);
  if (!result.success) {
    return null;
  }

  const { transaction } = result;
  if (actionIndex < 0 || actionIndex >= transaction.actions.length) {
    return null;
  }

  return transaction.actions[actionIndex];
}
