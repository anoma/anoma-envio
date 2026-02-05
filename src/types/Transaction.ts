/**
 * Transaction type definitions following Anoma specification.
 *
 * A Transaction is the top-level structure containing actions and proofs.
 * The delta proof proves that the sum of all deltas in all compliance units is zero,
 * and the aggregation proof aggregates all compliance proofs into a single proof.
 *
 * From PA-EVM Types.sol:
 * struct Transaction {
 *     Action[] actions;
 *     bytes deltaProof;
 *     bytes aggregationProof;
 * }
 */

import { Action } from "./Action";

export interface Transaction {
  actions: Action[];
  deltaProof: `0x${string}`;
  aggregationProof: `0x${string}`;
}

export interface TransactionExecutedEvent {
  tags: `0x${string}`[];
  logicRefs: `0x${string}`[];
}
