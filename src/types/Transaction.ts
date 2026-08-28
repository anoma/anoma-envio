/**
 * Transaction type definitions following Anoma specification.
 *
 * A Transaction is the top-level structure containing actions and proofs. The delta proof proves
 * that the sum of all action deltas is zero; the aggregation proof is the single recursive proof
 * covering every compliance unit and resource logic in the transaction.
 *
 * From PA-EVM interfaces/IProtocolAdapter.sol:
 * struct Transaction {
 *     Action[] actions;
 *     bytes deltaProof;
 *     bytes aggregationProof;
 * }
 */

import type { Hex } from "viem";

import type { Action } from "./Action.js";

export interface Transaction {
  actions: Action[];
  deltaProof: Hex;
  aggregationProof: Hex;
}
