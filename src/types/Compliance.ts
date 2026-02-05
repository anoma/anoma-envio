/**
 * Compliance type definitions following Anoma specification.
 *
 * Compliance units verify the validity of resource consumption and creation.
 */

export interface ConsumedRefs {
  nullifier: `0x${string}`;
  logicRef: `0x${string}`;
  commitmentTreeRoot: `0x${string}`;
}

export interface CreatedRefs {
  commitment: `0x${string}`;
  logicRef: `0x${string}`;
}

export interface ComplianceInstance {
  consumed: ConsumedRefs;
  created: CreatedRefs;
  unitDeltaX: `0x${string}`;
  unitDeltaY: `0x${string}`;
}

export interface ComplianceVerifierInput {
  proof: `0x${string}`;
  instance: ComplianceInstance;
}
