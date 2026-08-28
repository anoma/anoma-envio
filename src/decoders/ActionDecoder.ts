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

import {
  decodeFunctionData,
  toFunctionSelector,
  type Abi,
  type DecodeFunctionDataReturnType,
  type Hex,
} from "viem";
import type {
  Transaction,
  Action,
  Consumed,
  Created,
  AppData,
  ExpirableBlob,
} from "../types/index.js";
import { DeletionCriterion } from "../types/index.js";

const EXPIRABLE_BLOB_COMPONENTS = [
  { name: "deletionCriterion", type: "uint8" },
  { name: "blob", type: "bytes" },
] as const;

/** The four payload slots of AppData, each a list of `(uint8 deletionCriterion, bytes blob)`. */
const APP_DATA_COMPONENT = {
  name: "appData",
  type: "tuple",
  components: [
    { name: "resourcePayload", type: "tuple[]", components: EXPIRABLE_BLOB_COMPONENTS },
    { name: "discoveryPayload", type: "tuple[]", components: EXPIRABLE_BLOB_COMPONENTS },
    { name: "externalPayload", type: "tuple[]", components: EXPIRABLE_BLOB_COMPONENTS },
    { name: "applicationPayload", type: "tuple[]", components: EXPIRABLE_BLOB_COMPONENTS },
  ],
} as const;

// ABI for the execute function with nested structs. The canonical signature is
// execute((((bytes32,bytes32,bytes32,((uint8,bytes)[],(uint8,bytes)[],(uint8,bytes)[],(uint8,bytes)[]))[],
//          (bytes32,bytes32,((uint8,bytes)[],(uint8,bytes)[],(uint8,bytes)[],(uint8,bytes)[]))[],
//          (uint256,uint256),bytes32)[],bytes,bytes))
export const EXECUTE_ABI = [
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
] as const satisfies Abi;

/**
 * Function selector for `execute`, derived from EXECUTE_ABI so it can never drift from the shape
 * the decoder actually feeds to viem.
 */
export const EXECUTE_SELECTOR: Hex = toFunctionSelector(EXECUTE_ABI[0]);

type RawTransaction = DecodeFunctionDataReturnType<typeof EXECUTE_ABI>["args"][0];
type RawAction = RawTransaction["actions"][number];
type RawConsumed = RawAction["consumed"][number];
type RawCreated = RawAction["created"][number];
type RawAppData = RawConsumed["appData"];
type RawExpirableBlob = RawAppData["resourcePayload"][number];

export interface DecodedTransactionResult {
  transaction: Transaction;
  success: true;
}

export interface DecodedTransactionError {
  success: false;
  error: string;
}

export type DecodedTransactionResponse = DecodedTransactionResult | DecodedTransactionError;

function convertExpirableBlob(raw: RawExpirableBlob): ExpirableBlob {
  return {
    deletionCriterion:
      raw.deletionCriterion === 0 ? DeletionCriterion.Immediately : DeletionCriterion.Never,
    blob: raw.blob,
  };
}

function convertAppData(raw: RawAppData): AppData {
  return {
    resourcePayload: raw.resourcePayload.map(convertExpirableBlob),
    discoveryPayload: raw.discoveryPayload.map(convertExpirableBlob),
    externalPayload: raw.externalPayload.map(convertExpirableBlob),
    applicationPayload: raw.applicationPayload.map(convertExpirableBlob),
  };
}

function convertConsumed(raw: RawConsumed): Consumed {
  return {
    nullifier: raw.nullifier,
    logicRef: raw.logicRef,
    commitmentTreeRoot: raw.commitmentTreeRoot,
    appData: convertAppData(raw.appData),
  };
}

function convertCreated(raw: RawCreated): Created {
  return {
    commitment: raw.commitment,
    logicRef: raw.logicRef,
    appData: convertAppData(raw.appData),
  };
}

function convertAction(raw: RawAction): Action {
  return {
    consumed: raw.consumed.map(convertConsumed),
    created: raw.created.map(convertCreated),
    unitDelta: { x: raw.unitDelta.x, y: raw.unitDelta.y },
    actionTreeRoot: raw.actionTreeRoot,
  };
}

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
    if (!input || input === "0x") {
      return { success: false, error: "Empty calldata" };
    }

    const hexInput: Hex = input.startsWith("0x") ? (input as Hex) : `0x${input}`;

    const selector = hexInput.slice(0, 10).toLowerCase();
    if (selector !== EXECUTE_SELECTOR) {
      return {
        success: false,
        error: `Unknown function selector: ${selector}, expected ${EXECUTE_SELECTOR}`,
      };
    }

    const decoded = decodeFunctionData({ abi: EXECUTE_ABI, data: hexInput });
    return { success: true, transaction: convertTransaction(decoded.args[0]) };
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
