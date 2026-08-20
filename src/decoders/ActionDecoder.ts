/**
 * Decoder for ProtocolAdapter.execute() transaction calldata.
 *
 * This decoder extracts the full Transaction structure from calldata, including each Action with
 * the public data of the resources it consumes and creates.
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
 *     Consumed[] consumed;
 *     Created[] created;
 *     Delta unitDelta;
 *     bytes32 actionTreeRoot;
 * }
 *
 * All of these are declared in PA-EVM interfaces/IProtocolAdapter.sol.
 */

import { decodeFunctionData, toFunctionSelector, type Hex, type Abi } from "viem";
import type {
  Transaction,
  Action,
  Consumed,
  Created,
  AppData,
  ExpirableBlob,
} from "../types/index.js";
import { DeletionCriterion } from "../types/index.js";

/** The four payload slots of AppData, each a list of `(uint8 deletionCriterion, bytes blob)`. */
const APP_DATA_COMPONENT = {
  name: "appData",
  type: "tuple",
  components: (
    ["resourcePayload", "discoveryPayload", "externalPayload", "applicationPayload"] as const
  ).map((name) => ({
    name,
    type: "tuple[]",
    components: [
      { name: "deletionCriterion", type: "uint8" },
      { name: "blob", type: "bytes" },
    ],
  })),
} as const;

// ABI for the execute function with nested structs. The canonical signature is
// execute((((bytes32,bytes32,bytes32,((uint8,bytes)[],(uint8,bytes)[],(uint8,bytes)[],(uint8,bytes)[]))[],
//          (bytes32,bytes32,((uint8,bytes)[],(uint8,bytes)[],(uint8,bytes)[],(uint8,bytes)[]))[],
//          (uint256,uint256),bytes32)[],bytes,bytes))
export const EXECUTE_ABI: Abi = [
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
                name: "consumed",
                type: "tuple[]",
                components: [
                  { name: "nullifier", type: "bytes32" },
                  { name: "logicRef", type: "bytes32" },
                  { name: "commitmentTreeRoot", type: "bytes32" },
                  APP_DATA_COMPONENT,
                ],
              },
              {
                name: "created",
                type: "tuple[]",
                components: [
                  { name: "commitment", type: "bytes32" },
                  { name: "logicRef", type: "bytes32" },
                  APP_DATA_COMPONENT,
                ],
              },
              {
                name: "unitDelta",
                type: "tuple",
                components: [
                  { name: "x", type: "uint256" },
                  { name: "y", type: "uint256" },
                ],
              },
              { name: "actionTreeRoot", type: "bytes32" },
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

/**
 * Function selector for `execute`, derived from EXECUTE_ABI so it can never drift from the shape
 * the decoder actually feeds to viem.
 */
export const EXECUTE_SELECTOR: Hex = toFunctionSelector(
  EXECUTE_ABI[0] as Parameters<typeof toFunctionSelector>[0]
);

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

interface RawConsumed {
  nullifier: Hex;
  logicRef: Hex;
  commitmentTreeRoot: Hex;
  appData: RawAppData;
}

interface RawCreated {
  commitment: Hex;
  logicRef: Hex;
  appData: RawAppData;
}

interface RawAction {
  consumed: readonly RawConsumed[];
  created: readonly RawCreated[];
  unitDelta: { x: bigint; y: bigint };
  actionTreeRoot: Hex;
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
 * Convert the public data of a raw consumed resource to typed format
 */
function convertConsumed(raw: RawConsumed): Consumed {
  return {
    nullifier: raw.nullifier,
    logicRef: raw.logicRef,
    commitmentTreeRoot: raw.commitmentTreeRoot,
    appData: convertAppData(raw.appData),
  };
}

/**
 * Convert the public data of a raw created resource to typed format
 */
function convertCreated(raw: RawCreated): Created {
  return {
    commitment: raw.commitment,
    logicRef: raw.logicRef,
    appData: convertAppData(raw.appData),
  };
}

/**
 * Convert raw action from ABI decoding to typed format
 */
function convertAction(raw: RawAction): Action {
  return {
    consumed: raw.consumed.map(convertConsumed),
    created: raw.created.map(convertCreated),
    unitDelta: { x: raw.unitDelta.x, y: raw.unitDelta.y },
    actionTreeRoot: raw.actionTreeRoot,
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
