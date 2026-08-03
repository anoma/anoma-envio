/**
 * Minimal encoder for ProtocolAdapter.execute() calldata, used to build synthetic
 * multi-action transactions in handler tests. Encodes with the same EXECUTE_ABI the
 * decoder consumes, so round-trips are faithful to the on-chain struct layout.
 *
 * A round-trip through one ABI cannot catch a self-consistently wrong ABI. That is what
 * `ActionDecoder.test.ts` pins the derived selector against the contract's own signature for.
 */
import { encodeFunctionData, type Hex } from "viem";
import { EXECUTE_ABI } from "../../src/decoders/ActionDecoder.js";
import { DeletionCriterion } from "../../src/types/index.js";

const ZERO32 = ("0x" + "00".repeat(32)) as Hex;

/** Deterministic bytes32 from a short seed (e.g. b32("n0")). */
export function b32(seed: string): Hex {
  const hex = Buffer.from(seed, "utf8").toString("hex");
  return ("0x" + hex.padEnd(64, "0").slice(0, 64)) as Hex;
}

type Blob = { deletionCriterion: number; blob: Hex };

export type AppDataInput = {
  resourcePayload?: Blob[];
  discoveryPayload?: Blob[];
  externalPayload?: Blob[];
  applicationPayload?: Blob[];
};

/** One payload blob. Defaults to `Immediately`, which the contract never emits an event for. */
export function blob(
  data: Hex,
  deletionCriterion: DeletionCriterion = DeletionCriterion.Immediately
): Blob {
  return { deletionCriterion, blob: data };
}

function appData(input: AppDataInput = {}) {
  return {
    resourcePayload: input.resourcePayload ?? [],
    discoveryPayload: input.discoveryPayload ?? [],
    externalPayload: input.externalPayload ?? [],
    applicationPayload: input.applicationPayload ?? [],
  };
}

/** The public data of one consumed resource. */
export function consumed(nullifier: Hex, logicRef: Hex = ZERO32, payloads: AppDataInput = {}) {
  return {
    nullifier,
    logicRef,
    commitmentTreeRoot: ZERO32,
    appData: appData(payloads),
  };
}

/** The public data of one created resource. */
export function created(commitment: Hex, logicRef: Hex = ZERO32, payloads: AppDataInput = {}) {
  return { commitment, logicRef, appData: appData(payloads) };
}

export function action(
  consumedResources: ReturnType<typeof consumed>[],
  createdResources: ReturnType<typeof created>[],
  actionTreeRoot: Hex = ZERO32,
  delta: { x: bigint; y: bigint } = { x: 0n, y: 0n }
) {
  return {
    consumed: consumedResources,
    created: createdResources,
    delta,
    actionTreeRoot,
  };
}

/** Encode a full execute() transaction from a list of actions. */
export function encodeExecute(actions: ReturnType<typeof action>[]): Hex {
  return encodeFunctionData({
    abi: EXECUTE_ABI,
    functionName: "execute",
    args: [{ actions, deltaProof: "0x" as Hex, aggregationProof: "0x" as Hex }],
  });
}
