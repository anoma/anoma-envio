/**
 * Minimal encoder for ProtocolAdapter.execute() calldata, used to build synthetic
 * multi-action transactions in handler tests. Encodes with the same EXECUTE_ABI the
 * decoder consumes, so round-trips are faithful to the on-chain struct layout.
 */
import { encodeFunctionData, type Hex } from "viem";
import { EXECUTE_ABI } from "../../src/decoders/ActionDecoder.js";

const ZERO32 = ("0x" + "00".repeat(32)) as Hex;

/** Deterministic bytes32 from a short seed (e.g. b32("n0")). */
export function b32(seed: string): Hex {
  const hex = Buffer.from(seed, "utf8").toString("hex");
  return ("0x" + hex.padEnd(64, "0").slice(0, 64)) as Hex;
}

const emptyAppData = () => ({
  resourcePayload: [] as unknown[],
  discoveryPayload: [] as unknown[],
  externalPayload: [] as unknown[],
  applicationPayload: [] as unknown[],
});

/** One logic verifier input (one resource). */
export function logicInput(tag: Hex, verifyingKey: Hex) {
  return { tag, verifyingKey, appData: emptyAppData(), proof: "0x" as Hex };
}

/** One compliance verifier input (one consumed + one created resource). */
export function complianceInput(nullifier: Hex, commitment: Hex, logicRef: Hex = ZERO32) {
  return {
    proof: "0x" as Hex,
    instance: {
      consumed: { nullifier, logicRef, commitmentTreeRoot: ZERO32 },
      created: { commitment, logicRef },
      unitDeltaX: ZERO32,
      unitDeltaY: ZERO32,
    },
  };
}

export function action(
  logicVerifierInputs: ReturnType<typeof logicInput>[],
  complianceVerifierInputs: ReturnType<typeof complianceInput>[]
) {
  return { logicVerifierInputs, complianceVerifierInputs };
}

/** Encode a full execute() transaction from a list of actions. */
export function encodeExecute(actions: ReturnType<typeof action>[]): Hex {
  return encodeFunctionData({
    abi: EXECUTE_ABI,
    functionName: "execute",
    args: [{ actions, deltaProof: "0x" as Hex, aggregationProof: "0x" as Hex }],
  });
}
