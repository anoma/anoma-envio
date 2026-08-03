/**
 * Transaction type definitions following Anoma specification.
 *
 * A Transaction is the top-level structure containing actions and proofs. The delta proof proves
 * that the sum of all action deltas is zero; the aggregation proof is the single recursive proof
 * covering every compliance unit and resource logic in the transaction.
 *
 * From PA-EVM Types.sol:
 * struct Transaction {
 *     Action[] actions;
 *     bytes deltaProof;
 *     bytes aggregationProof;
 * }
 */

import type { Action } from "./Action";

export interface Transaction {
  actions: Action[];
  deltaProof: `0x${string}`;
  aggregationProof: `0x${string}`;
}

/**
 * The transaction id is the Keccak-256 hash of the concatenated action tree roots — the message
 * the delta proof signs, unique per transaction and known to the sender before submission.
 */
export interface TransactionExecutedEvent {
  transactionId: `0x${string}`;
}
