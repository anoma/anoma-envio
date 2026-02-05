/**
 * Logic type definitions following Anoma specification.
 *
 * Logic verifier inputs contain the application data and proofs for resources.
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

export interface LogicInstance {
  tag: `0x${string}`;
  isConsumed: boolean;
  actionTreeRoot: `0x${string}`;
  appData: AppData;
}

export interface LogicVerifierInput {
  tag: `0x${string}`;
  verifyingKey: `0x${string}`;
  appData: AppData;
  proof: `0x${string}`;
}
