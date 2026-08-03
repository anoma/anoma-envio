/**
 * Action type definitions following Anoma specification.
 *
 * An Action provides context separation between non-intersecting sets of resources and
 * corresponds to one compliance unit constraining the resources it consumes and creates. It is
 * n:m — any number of consumed and created resources — carrying a single action-level delta.
 *
 * From PA-EVM Types.sol:
 * struct Action {
 *     Consumed[] consumed;
 *     Created[] created;
 *     Delta.Point delta;
 *     bytes32 actionTreeRoot;
 * }
 */

import type { Consumed, Created } from "./Resource";

/** A secp256k1 point (Delta.Point in PA-EVM libs/proving/Delta.sol). */
export interface DeltaPoint {
  x: bigint;
  y: bigint;
}

export interface Action {
  consumed: Consumed[];
  created: Created[];
  delta: DeltaPoint;
  actionTreeRoot: `0x${string}`;
}

export interface ActionExecutedEvent {
  actionTreeRoot: `0x${string}`;
  nullifiers: `0x${string}`[];
  consumedLogicRefs: `0x${string}`[];
  commitments: `0x${string}`[];
  createdLogicRefs: `0x${string}`[];
}
