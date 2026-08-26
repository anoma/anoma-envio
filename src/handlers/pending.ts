import { BoundedCache } from "../utils/BoundedCache.js";
import { DECODED_CALLDATA_CACHE_MAX_SIZE } from "../constants.js";

// ============================================
// Pending Entity Cache
// ============================================
// Actions and tags are created before TransactionExecuted arrives, so they are written with the
// EVM-transaction correlation key as their transaction_id. This tracks what to relink once the
// real Transaction id (which includes the logIndex) is known. Keyed by evmTxId; consumed and
// cleared on each TransactionExecuted.
//
// `actions` is a Map<actionId, arrivalIndex> so that (a) a preload double-run of ActionExecuted
// for the same action reuses the same key (idempotent), and (b) the k-th distinct ActionExecuted
// maps to decoded.actions[k] — the contract emits ActionExecuted once per action in calldata
// order, so arrival order equals decoded-action order.
type PendingEntities = { actions: Map<string, number>; tags: Set<string> };

export const pendingEntities = new BoundedCache<string, PendingEntities>(
  DECODED_CALLDATA_CACHE_MAX_SIZE
);

export function getPendingEntities(evmTxId: string): PendingEntities {
  const existing = pendingEntities.get(evmTxId);
  if (existing) {
    return existing;
  }
  const created: PendingEntities = { actions: new Map<string, number>(), tags: new Set<string>() };
  pendingEntities.set(evmTxId, created);
  return created;
}
