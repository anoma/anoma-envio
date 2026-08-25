/**
 * Logic type definitions following Anoma specification.
 *
 * App data travels with each consumed and created resource and carries the payload blobs the
 * protocol adapter re-emits as payload events.
 *
 * From PA-EVM interfaces/IProtocolAdapter.sol.
 */

export enum DeletionCriterion {
  Immediately = 0,
  Never = 1,
}

export interface ExpirableBlob {
  deletionCriterion: DeletionCriterion;
  blob: `0x${string}`;
}

export interface AppData {
  resourcePayload: ExpirableBlob[];
  discoveryPayload: ExpirableBlob[];
  externalPayload: ExpirableBlob[];
  applicationPayload: ExpirableBlob[];
}
