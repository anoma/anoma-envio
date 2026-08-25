/**
 * Event handlers for Anoma Protocol Adapter events.
 *
 * PA-EVM Event Order (within same EVM transaction), per pa-evm ProtocolAdapter._execute:
 * 1. ForwarderCallExecuted (per external payload, before that resource's payload events)
 * 2. ResourcePayload/DiscoveryPayload/ExternalPayload/ApplicationPayload (per resource)
 * 3. ActionExecuted (once per action)
 * 4. CommitmentTreeRootAdded (once, after all actions, when commitments were added)
 * 5. TransactionExecuted (once at the end)
 *
 * ActionExecuted is the authoritative source of tags: it carries the consumed nullifiers and
 * created commitments as separate arrays, each paired with its logic reference. TransactionExecuted
 * carries only the transaction id, so entities created before it hold the EVM-transaction
 * correlation key and are relinked when it arrives.
 */

import { indexer } from "envio";
import type {
  EvmOnEventContext,
  EVMTransaction,
  Transaction,
  Tag,
  Action,
  Resource,
  Payload,
  CommitmentTreeRoot,
  ForwarderCall,
  OwnershipTransferred,
  ProtocolAdapterPaused,
  Stats,
  ChainStats,
} from "envio";

import { decodeExecuteCalldata, isExecuteCalldata } from "./decoders/ActionDecoder.js";
import { DeletionCriterion } from "./types/index.js";
import type { Action as DecodedAction, AppData } from "./types/index.js";
import { BoundedCache } from "./utils/BoundedCache.js";
import { DECODED_CALLDATA_CACHE_MAX_SIZE, getUTCDay } from "./constants.js";

// ============================================
// Helper Functions
// ============================================

/**
 * Creates a unique event identifier from event metadata.
 */
function createEventId(event: {
  chainId: number;
  block: { number: number };
  logIndex: number;
  srcAddress: string;
}): string {
  return `${event.chainId}_${event.block.number}_${event.logIndex}_${event.srcAddress}`;
}

/**
 * Creates an EVM transaction identifier (correlation key shared by all events
 * in the same EVM transaction). Also the EVMTransaction entity's ID.
 */
function createEvmTxId(chainId: number, txHash: string): string {
  return `${chainId}_${txHash}`;
}

/**
 * Creates a unique AP Transaction identifier. Includes logIndex because
 * multiple execute() calls in the same EVM tx (e.g., via multicall) each
 * emit their own TransactionExecuted event with a distinct logIndex.
 */
function createTransactionId(chainId: number, txHash: string, logIndex: number): string {
  return `${chainId}_${txHash}_${logIndex}`;
}

/**
 * Creates a tag identifier from chain and tag hash.
 * Tag hashes are globally unique (cryptographic commitments/nullifiers).
 */
function createTagId(chainId: number, tagHash: string): string {
  return `${chainId}_${tagHash}`;
}

/**
 * Creates a resource identifier from its action and position in the action's tag order.
 */
function createResourceId(actionId: string, index: number): string {
  return `${actionId}_resource_${index}`;
}

// ============================================
// Calldata Decoding Cache
// ============================================
// Cache decoded calldata by txHash to avoid re-decoding for each ActionExecuted event
// within the same EVM transaction. Uses BoundedCache to prevent unbounded memory growth.
type DecodedCalldata = {
  actions: DecodedAction[];
  deltaProof: string;
  aggregationProof: string;
};

const decodedCalldataCache = new BoundedCache<string, DecodedCalldata>(
  DECODED_CALLDATA_CACHE_MAX_SIZE
);

/**
 * Get decoded transaction data from cache or decode from calldata.
 */
function getDecodedTransaction(txHash: string, input: string | undefined): DecodedCalldata | null {
  // Check cache first
  const cached = decodedCalldataCache.get(txHash);
  if (cached) {
    return cached;
  }

  // Try to decode calldata
  if (!input || !isExecuteCalldata(input)) {
    return null;
  }

  const result = decodeExecuteCalldata(input);
  if (!result.success) {
    console.log(`Failed to decode calldata for tx ${txHash}: ${result.error}`);
    return null;
  }

  // Cache the result
  const decoded = {
    actions: result.transaction.actions,
    deltaProof: result.transaction.deltaProof,
    aggregationProof: result.transaction.aggregationProof,
  };
  decodedCalldataCache.set(txHash, decoded);

  return decoded;
}

/**
 * Clear cache entry after transaction is fully processed.
 */
function clearDecodedCache(txHash: string): void {
  decodedCalldataCache.delete(txHash);
}

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

const pendingEntities = new BoundedCache<string, PendingEntities>(DECODED_CALLDATA_CACHE_MAX_SIZE);

function getPendingEntities(evmTxId: string): PendingEntities {
  const existing = pendingEntities.get(evmTxId);
  if (existing) {
    return existing;
  }
  const created: PendingEntities = { actions: new Map<string, number>(), tags: new Set<string>() };
  pendingEntities.set(evmTxId, created);
  return created;
}

// ============================================
// Stats Singleton
// ============================================
const STATS_ID = "global";

/**
 * Gets the current stats or creates a new one with zero counts.
 */
async function getOrCreateStats(context: EvmOnEventContext): Promise<Stats> {
  const existing = await context.Stats.get(STATS_ID);
  if (existing) {
    return existing;
  }
  return {
    id: STATS_ID,
    transactions: 0n,
    tags: 0n,
    tagsConsumed: 0n,
    tagsCreated: 0n,
    actions: 0n,
    resources: 0n,
    commitmentRoots: 0n,
    distinctLogics: 0n,
    externalCalls: 0n,
    forwarderCalls: 0n,
    resourcePayloads: 0n,
    discoveryPayloads: 0n,
    applicationPayloads: 0n,
    lastUpdatedBlock: 0n,
    lastUpdatedTimestamp: 0n,
  };
}

async function getOrCreateChainStats(
  context: EvmOnEventContext,
  chainId: number
): Promise<ChainStats> {
  const id = String(chainId);
  const existing = await context.ChainStats.get(id);
  if (existing) {
    return existing;
  }
  return {
    id,
    chainId: BigInt(chainId),
    transactions: 0n,
    tags: 0n,
    tagsConsumed: 0n,
    tagsCreated: 0n,
    actions: 0n,
    resources: 0n,
    commitmentRoots: 0n,
    distinctLogics: 0n,
    externalCalls: 0n,
    forwarderCalls: 0n,
    resourcePayloads: 0n,
    discoveryPayloads: 0n,
    applicationPayloads: 0n,
    lastUpdatedBlock: 0n,
    lastUpdatedTimestamp: 0n,
  };
}

/**
 * Unified helper: increments global Stats + DailyStats + per-chain
 * ChainStats + ChainDailyStats. All handler call sites use this.
 *
 * `distinctLogics` applies to the global Stats; `chainDistinctLogics`
 * applies to ChainStats (these can differ — a logic seen on two chains
 * counts once globally but once per chain). DailyStats and
 * ChainDailyStats do not track distinctLogics.
 */
async function incrementAllStats(
  context: EvmOnEventContext,
  chainId: number,
  blockNumber: number,
  timestamp: number,
  increments: {
    transactions?: number;
    tags?: number;
    tagsConsumed?: number;
    tagsCreated?: number;
    actions?: number;
    resources?: number;
    commitmentRoots?: number;
    distinctLogics?: number;
    chainDistinctLogics?: number;
    externalCalls?: number;
    forwarderCalls?: number;
    resourcePayloads?: number;
    discoveryPayloads?: number;
    applicationPayloads?: number;
  }
): Promise<void> {
  const { dateKey, dayTimestamp } = getUTCDay(timestamp);
  const chainDateKey = `${chainId}-${dateKey}`;

  const [stats, daily, chainStats, chainDaily] = await Promise.all([
    getOrCreateStats(context),
    context.DailyStats.get(dateKey).then(
      (existing) =>
        existing || {
          id: dateKey,
          dayTimestamp,
          transactions: 0n,
          tags: 0n,
          tagsConsumed: 0n,
          tagsCreated: 0n,
          actions: 0n,
          resources: 0n,
          commitmentRoots: 0n,
          externalCalls: 0n,
          forwarderCalls: 0n,
          resourcePayloads: 0n,
          discoveryPayloads: 0n,
          applicationPayloads: 0n,
          lastUpdatedBlock: 0n,
          lastUpdatedTimestamp: 0n,
        }
    ),
    getOrCreateChainStats(context, chainId),
    context.ChainDailyStats.get(chainDateKey).then(
      (existing) =>
        existing || {
          id: chainDateKey,
          chainId: BigInt(chainId),
          date: dateKey,
          dayTimestamp,
          transactions: 0n,
          tags: 0n,
          tagsConsumed: 0n,
          tagsCreated: 0n,
          actions: 0n,
          resources: 0n,
          commitmentRoots: 0n,
          externalCalls: 0n,
          forwarderCalls: 0n,
          resourcePayloads: 0n,
          discoveryPayloads: 0n,
          applicationPayloads: 0n,
          lastUpdatedBlock: 0n,
          lastUpdatedTimestamp: 0n,
        }
    ),
  ]);

  context.Stats.set({
    ...stats,
    transactions: stats.transactions + BigInt(increments.transactions ?? 0),
    tags: stats.tags + BigInt(increments.tags ?? 0),
    tagsConsumed: stats.tagsConsumed + BigInt(increments.tagsConsumed ?? 0),
    tagsCreated: stats.tagsCreated + BigInt(increments.tagsCreated ?? 0),
    actions: stats.actions + BigInt(increments.actions ?? 0),
    resources: stats.resources + BigInt(increments.resources ?? 0),
    commitmentRoots: stats.commitmentRoots + BigInt(increments.commitmentRoots ?? 0),
    distinctLogics: stats.distinctLogics + BigInt(increments.distinctLogics ?? 0),
    externalCalls: stats.externalCalls + BigInt(increments.externalCalls ?? 0),
    forwarderCalls: stats.forwarderCalls + BigInt(increments.forwarderCalls ?? 0),
    resourcePayloads: stats.resourcePayloads + BigInt(increments.resourcePayloads ?? 0),
    discoveryPayloads: stats.discoveryPayloads + BigInt(increments.discoveryPayloads ?? 0),
    applicationPayloads: stats.applicationPayloads + BigInt(increments.applicationPayloads ?? 0),
    lastUpdatedBlock: BigInt(blockNumber),
    lastUpdatedTimestamp: BigInt(timestamp),
  });

  context.DailyStats.set({
    ...daily,
    transactions: daily.transactions + BigInt(increments.transactions ?? 0),
    tags: daily.tags + BigInt(increments.tags ?? 0),
    tagsConsumed: daily.tagsConsumed + BigInt(increments.tagsConsumed ?? 0),
    tagsCreated: daily.tagsCreated + BigInt(increments.tagsCreated ?? 0),
    actions: daily.actions + BigInt(increments.actions ?? 0),
    resources: daily.resources + BigInt(increments.resources ?? 0),
    commitmentRoots: daily.commitmentRoots + BigInt(increments.commitmentRoots ?? 0),
    externalCalls: daily.externalCalls + BigInt(increments.externalCalls ?? 0),
    forwarderCalls: daily.forwarderCalls + BigInt(increments.forwarderCalls ?? 0),
    resourcePayloads: daily.resourcePayloads + BigInt(increments.resourcePayloads ?? 0),
    discoveryPayloads: daily.discoveryPayloads + BigInt(increments.discoveryPayloads ?? 0),
    applicationPayloads: daily.applicationPayloads + BigInt(increments.applicationPayloads ?? 0),
    lastUpdatedBlock: BigInt(blockNumber),
    lastUpdatedTimestamp: BigInt(timestamp),
  });

  context.ChainStats.set({
    ...chainStats,
    transactions: chainStats.transactions + BigInt(increments.transactions ?? 0),
    tags: chainStats.tags + BigInt(increments.tags ?? 0),
    tagsConsumed: chainStats.tagsConsumed + BigInt(increments.tagsConsumed ?? 0),
    tagsCreated: chainStats.tagsCreated + BigInt(increments.tagsCreated ?? 0),
    actions: chainStats.actions + BigInt(increments.actions ?? 0),
    resources: chainStats.resources + BigInt(increments.resources ?? 0),
    commitmentRoots: chainStats.commitmentRoots + BigInt(increments.commitmentRoots ?? 0),
    distinctLogics: chainStats.distinctLogics + BigInt(increments.chainDistinctLogics ?? 0),
    externalCalls: chainStats.externalCalls + BigInt(increments.externalCalls ?? 0),
    forwarderCalls: chainStats.forwarderCalls + BigInt(increments.forwarderCalls ?? 0),
    resourcePayloads: chainStats.resourcePayloads + BigInt(increments.resourcePayloads ?? 0),
    discoveryPayloads: chainStats.discoveryPayloads + BigInt(increments.discoveryPayloads ?? 0),
    applicationPayloads:
      chainStats.applicationPayloads + BigInt(increments.applicationPayloads ?? 0),
    lastUpdatedBlock: BigInt(blockNumber),
    lastUpdatedTimestamp: BigInt(timestamp),
  });

  context.ChainDailyStats.set({
    ...chainDaily,
    transactions: chainDaily.transactions + BigInt(increments.transactions ?? 0),
    tags: chainDaily.tags + BigInt(increments.tags ?? 0),
    tagsConsumed: chainDaily.tagsConsumed + BigInt(increments.tagsConsumed ?? 0),
    tagsCreated: chainDaily.tagsCreated + BigInt(increments.tagsCreated ?? 0),
    actions: chainDaily.actions + BigInt(increments.actions ?? 0),
    resources: chainDaily.resources + BigInt(increments.resources ?? 0),
    commitmentRoots: chainDaily.commitmentRoots + BigInt(increments.commitmentRoots ?? 0),
    externalCalls: chainDaily.externalCalls + BigInt(increments.externalCalls ?? 0),
    forwarderCalls: chainDaily.forwarderCalls + BigInt(increments.forwarderCalls ?? 0),
    resourcePayloads: chainDaily.resourcePayloads + BigInt(increments.resourcePayloads ?? 0),
    discoveryPayloads: chainDaily.discoveryPayloads + BigInt(increments.discoveryPayloads ?? 0),
    applicationPayloads:
      chainDaily.applicationPayloads + BigInt(increments.applicationPayloads ?? 0),
    lastUpdatedBlock: BigInt(blockNumber),
    lastUpdatedTimestamp: BigInt(timestamp),
  });
}

// ============================================
// TransactionExecuted Handler
// ============================================
// This event fires LAST in the transaction, after every action and payload event. It carries only
// the transaction id, so its job is to create the Transaction entity and relink the actions and
// tags that earlier handlers wrote against the EVM-transaction correlation key.

indexer.onEvent(
  { contract: "ProtocolAdapter", event: "TransactionExecuted" },
  async ({ event, context }) => {
    const evmTxId = createEvmTxId(event.chainId, event.transaction.hash);
    const txId = createTransactionId(event.chainId, event.transaction.hash, event.logIndex);
    const txHash = event.transaction.hash;

    // Try to decode calldata for proofs
    // Note: event.transaction.input is available because we added "input" to field_selection
    const decoded = getDecodedTransaction(txHash, event.transaction.input);

    // Create EVMTransaction entity (the carrier/wrapper, shared by all AP txs in this EVM tx)
    const evmTxEntity: EVMTransaction = {
      id: evmTxId,
      txHash: txHash,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
      chainId: BigInt(event.chainId),
      from: event.transaction.from,
      value: event.transaction.value,
    };

    context.EVMTransaction.set(evmTxEntity);

    // Create Transaction entity (Anoma Transaction payload — unique per AP tx)
    const txEntity: Transaction = {
      id: txId,
      logIndex: event.logIndex,
      contractAddress: event.srcAddress,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
      chainId: BigInt(event.chainId),
      transactionId: event.params.transactionId,
      deltaProof: decoded?.deltaProof,
      aggregationProof: decoded?.aggregationProof,
      evmTransaction_id: evmTxId,
    };

    context.Transaction.set(txEntity);

    // Relink the actions and tags written by earlier handlers so their transaction_id points to
    // this Transaction instead of the temporary evmTxId. The guard (=== evmTxId) makes a preload
    // double-run idempotent: already-linked entities are not re-linked to the wrong txId.
    const pending = pendingEntities.get(evmTxId);
    if (pending) {
      const [actions, tags] = await Promise.all([
        Promise.all([...pending.actions.keys()].map((id) => context.Action.get(id))),
        Promise.all([...pending.tags].map((id) => context.Tag.get(id))),
      ]);

      for (const action of actions) {
        if (action && action.transaction_id === evmTxId) {
          context.Action.set({ ...action, transaction_id: txId });
        }
      }
      for (const tag of tags) {
        if (tag && tag.transaction_id === evmTxId) {
          context.Tag.set({ ...tag, transaction_id: txId });
        }
      }

      if (!context.isPreload) {
        pendingEntities.delete(evmTxId);
      }
    }

    await incrementAllStats(context, event.chainId, event.block.number, event.block.timestamp, {
      transactions: 1,
    });

    // Clear the cache after processing is complete. Not during preload: the sequential pass
    // still has to decode this transaction.
    if (!context.isPreload) {
      clearDecodedCache(txHash);
    }
  }
);

// ============================================
// ActionExecuted Handler
// ============================================
// ActionExecuted fires BEFORE TransactionExecuted but AFTER payload events. It is authoritative
// for which tags the action consumed and created, and for their logic references. Calldata
// decoding adds what the event cannot carry: the action's unit delta, the commitment tree root each
// consumed resource was proven against, and the app data payload counts.

indexer.onEvent(
  { contract: "ProtocolAdapter", event: "ActionExecuted" },
  async ({ event, context }) => {
    const evmTxId = createEvmTxId(event.chainId, event.transaction.hash);
    const txHash = event.transaction.hash;
    // Use evmTxId + actionTreeRoot for unique action ID since multiple actions can be in one tx
    const actionId = `${evmTxId}_${event.params.actionTreeRoot}`;

    const nullifiers = event.params.nullifiers;
    const commitments = event.params.commitments;
    const consumedLogicRefs = event.params.consumedLogicRefs;
    const createdLogicRefs = event.params.createdLogicRefs;

    // Try to decode calldata to get action details
    const decoded = getDecodedTransaction(txHash, event.transaction.input);

    // Map this ActionExecuted to its position among the EVM tx's actions. The contract emits
    // ActionExecuted once per action in calldata order, so the k-th distinct ActionExecuted
    // corresponds to decoded.actions[k]. The index is memoised per actionId so a preload
    // double-run is idempotent, and TransactionExecuted still relinks by iterating the keys.
    const pending = getPendingEntities(evmTxId);
    let actionIndex = pending.actions.get(actionId);
    if (actionIndex === undefined) {
      actionIndex = pending.actions.size;
      // The preload pass runs in parallel, so two ActionExecuted of the same transaction can
      // reach this concurrently and claim the same index. Only the sequential pass records it;
      // a provisional index in preload at worst warms a cache entry that is not needed.
      if (!context.isPreload) {
        pending.actions.set(actionId, actionIndex);
      }
    }

    if (decoded && actionIndex >= decoded.actions.length) {
      console.warn(
        `ActionExecuted #${actionIndex} for tx ${txHash} has no matching decoded action ` +
          `(calldata decoded ${decoded.actions.length} action(s)); resource details omitted.`
      );
    }
    const decodedAction: DecodedAction | null =
      decoded && actionIndex < decoded.actions.length ? decoded.actions[actionIndex] : null;

    // Create Action entity (transaction_id is temporary — TransactionExecuted will fix it)
    const actionEntity: Action = {
      id: actionId,
      index: actionIndex,
      logIndex: event.logIndex,
      actionTreeRoot: event.params.actionTreeRoot,
      actionTagCount: nullifiers.length + commitments.length,
      consumedCount: nullifiers.length,
      createdCount: commitments.length,
      blockNumber: BigInt(event.block.number),
      chainId: BigInt(event.chainId),
      timestamp: BigInt(event.block.timestamp),
      unitDeltaX: decodedAction ? decodedAction.unitDelta.x.toString() : undefined,
      unitDeltaY: decodedAction ? decodedAction.unitDelta.y.toString() : undefined,
      evmTxId: evmTxId,
      transaction_id: evmTxId,
    };

    context.Action.set(actionEntity);

    // The canonical tag order is the action tree leaf order: consumed nullifiers followed by
    // created commitments. Tag.index and Resource.index both follow it.
    const orderedTags = [
      ...nullifiers.map((tagHash, i) => ({
        tagHash,
        logicRef: consumedLogicRefs[i],
        isConsumed: true,
        appData: decodedAction?.consumed[i]?.appData,
        commitmentTreeRoot: decodedAction?.consumed[i]?.commitmentTreeRoot,
      })),
      ...commitments.map((tagHash, i) => ({
        tagHash,
        logicRef: createdLogicRefs[i],
        isConsumed: false,
        appData: decodedAction?.created[i]?.appData,
        commitmentTreeRoot: undefined,
      })),
    ];

    // Batch-fetch existing tags and logic-ref trackers (eliminates N+1 reads)
    const tagIds = orderedTags.map((t) => createTagId(event.chainId, t.tagHash));
    const uniqueLogicRefs = [...new Set(orderedTags.map((t) => t.logicRef))];
    const chainLogicRefIds = uniqueLogicRefs.map((ref) => `${event.chainId}-${ref}`);
    const [existingTags, existingLogicRefs, existingChainLogicRefs] = await Promise.all([
      Promise.all(tagIds.map((id) => context.Tag.get(id))),
      Promise.all(uniqueLogicRefs.map((ref) => context.LogicRef.get(ref))),
      Promise.all(chainLogicRefIds.map((id) => context.ChainLogicRef.get(id))),
    ]);

    for (let index = 0; index < orderedTags.length; index++) {
      const { tagHash, logicRef, isConsumed, appData, commitmentTreeRoot } = orderedTags[index];
      const tagId = tagIds[index];
      const resourceId = createResourceId(actionId, index);
      const existingTag = existingTags[index];

      // A payload event may already have created this tag with placeholder values; the event's
      // index, side and logic reference are authoritative.
      context.Tag.set({
        ...(existingTag ?? {
          id: tagId,
          tagHash: tagHash,
          blockNumber: BigInt(event.block.number),
          timestamp: BigInt(event.block.timestamp),
          chainId: BigInt(event.chainId),
          transaction_id: evmTxId,
        }),
        index: index,
        actionLogIndex: event.logIndex,
        isConsumed: isConsumed,
        logicRef: logicRef,
        resource_id: resourceId,
      });
      if (!context.isPreload) {
        pending.tags.add(tagId);
      }

      const resourceEntity: Resource = {
        id: resourceId,
        index: index,
        timestamp: BigInt(event.block.timestamp),
        chainId: BigInt(event.chainId),
        tagHash: tagHash,
        logicRef: logicRef,
        isConsumed: isConsumed,
        commitmentTreeRoot: commitmentTreeRoot,
        resourcePayloadCount: appData?.resourcePayload.length,
        discoveryPayloadCount: appData?.discoveryPayload.length,
        externalPayloadCount: appData?.externalPayload.length,
        applicationPayloadCount: appData?.applicationPayload.length,
        action_id: actionId,
        tag_id: tagId,
      };

      context.Resource.set(resourceEntity);

      if (appData) {
        writeImmediateExternalPayloads(context, resourceId, tagId, tagHash, appData);
      }
    }

    // Track distinct logic references — global and per-chain
    let newLogicCount = 0;
    let newChainLogicCount = 0;
    for (let i = 0; i < uniqueLogicRefs.length; i++) {
      if (!existingLogicRefs[i]) {
        context.LogicRef.set({
          id: uniqueLogicRefs[i],
          firstSeenBlock: BigInt(event.block.number),
          firstSeenTimestamp: BigInt(event.block.timestamp),
          firstSeenChainId: BigInt(event.chainId),
          firstSeenTxHash: txHash,
        });
        newLogicCount++;
      }
      if (!existingChainLogicRefs[i]) {
        context.ChainLogicRef.set({
          id: chainLogicRefIds[i],
          chainId: BigInt(event.chainId),
          logicRef: uniqueLogicRefs[i],
          firstSeenBlock: BigInt(event.block.number),
          firstSeenTimestamp: BigInt(event.block.timestamp),
          firstSeenTxHash: txHash,
        });
        newChainLogicCount++;
      }
    }

    await incrementAllStats(context, event.chainId, event.block.number, event.block.timestamp, {
      actions: 1,
      resources: orderedTags.length,
      tags: orderedTags.length,
      tagsConsumed: nullifiers.length,
      tagsCreated: commitments.length,
      distinctLogics: newLogicCount,
      chainDistinctLogics: newChainLogicCount,
    });
  }
);

/**
 * Writes Payload entities for the external payloads that never produce an event.
 *
 * The protocol adapter only emits payload events for blobs marked `Never`; an `Immediately` blob
 * is consumed for its forwarder call and then dropped. Taking those from calldata keeps the
 * external-call record complete without duplicating the ones ExternalPayload already covers.
 */
function writeImmediateExternalPayloads(
  context: EvmOnEventContext,
  resourceId: string,
  tagId: string,
  tagHash: string,
  appData: AppData
): void {
  for (let index = 0; index < appData.externalPayload.length; index++) {
    const blob = appData.externalPayload[index];
    if (blob.deletionCriterion !== DeletionCriterion.Immediately) {
      continue;
    }

    context.Payload.set({
      id: `${resourceId}_externalCall_${index}`,
      category: "externalCall",
      tagHash: tagHash,
      index: index,
      blob: blob.blob,
      deletionCriterion: "immediately",
      tag_id: tagId,
    });
  }
}

// ============================================
// ResourcePayload Handler
// ============================================
// ResourcePayload fires BEFORE ActionExecuted.
// Creates a Payload entity with category "resource" and creates the Tag entity if it is new.

indexer.onEvent(
  { contract: "ProtocolAdapter", event: "ResourcePayload" },
  async ({ event, context }) => {
    const tagId = createTagId(event.chainId, event.params.tag);
    const evmTxId = createEvmTxId(event.chainId, event.transaction.hash);

    // Create Payload entity with category "resource" (unified with other payload types)
    const payloadEntity = createPayloadEntity(event, "resource");
    context.Payload.set(payloadEntity);

    // Update stats
    await incrementAllStats(context, event.chainId, event.block.number, event.block.timestamp, {
      resourcePayloads: 1,
    });

    // Create the Tag entity if ActionExecuted has not yet supplied the authoritative values.
    const existingTag = await context.Tag.get(tagId);
    if (!existingTag) {
      const tagEntity: Tag = {
        id: tagId,
        tagHash: event.params.tag,
        index: 0, // Placeholder — ActionExecuted sets the canonical position
        actionLogIndex: undefined, // Set by ActionExecuted, which knows the action
        isConsumed: false, // Placeholder — ActionExecuted sets the side
        blockNumber: BigInt(event.block.number),
        timestamp: BigInt(event.block.timestamp),
        chainId: BigInt(event.chainId),
        transaction_id: evmTxId, // Temporary — TransactionExecuted will set the proper txId
        logicRef: undefined, // Will be set by ActionExecuted
        resource_id: undefined,
      };
      context.Tag.set(tagEntity);
      if (!context.isPreload) {
        getPendingEntities(evmTxId).tags.add(tagId);
      }
    }
  }
);

// ============================================
// Payload Handlers (Discovery, External, Application)
// ============================================
// All payload types are unified into a single Payload entity with a category discriminator.

/**
 * Creates a Payload entity with the specified category.
 * Note: blockNumber, chainId, timestamp are accessible via tag.transaction
 */
function createPayloadEntity(
  event: {
    chainId: number;
    block: { number: number; timestamp: number };
    logIndex: number;
    srcAddress: string;
    params: { tag: string; index: bigint; blob: string };
  },
  category: "resource" | "discovery" | "externalCall" | "application"
): Payload {
  const eventId = createEventId(event);
  const tagId = createTagId(event.chainId, event.params.tag);

  return {
    id: eventId,
    category: category,
    tagHash: event.params.tag,
    index: Number(event.params.index),
    blob: event.params.blob,
    // The protocol adapter only emits payload events for blobs marked `Never`.
    deletionCriterion: "never",
    tag_id: tagId,
  };
}

indexer.onEvent(
  { contract: "ProtocolAdapter", event: "DiscoveryPayload" },
  async ({ event, context }) => {
    const entity = createPayloadEntity(event, "discovery");
    context.Payload.set(entity);

    await incrementAllStats(context, event.chainId, event.block.number, event.block.timestamp, {
      discoveryPayloads: 1,
    });
  }
);

indexer.onEvent(
  { contract: "ProtocolAdapter", event: "ExternalPayload" },
  async ({ event, context }) => {
    const entity = createPayloadEntity(event, "externalCall");
    context.Payload.set(entity);

    await incrementAllStats(context, event.chainId, event.block.number, event.block.timestamp, {
      externalCalls: 1,
    });
  }
);

indexer.onEvent(
  { contract: "ProtocolAdapter", event: "ApplicationPayload" },
  async ({ event, context }) => {
    const entity = createPayloadEntity(event, "application");
    context.Payload.set(entity);

    await incrementAllStats(context, event.chainId, event.block.number, event.block.timestamp, {
      applicationPayloads: 1,
    });
  }
);

// ============================================
// CommitmentTreeRootAdded Handler
// ============================================

indexer.onEvent(
  { contract: "ProtocolAdapter", event: "CommitmentTreeRootAdded" },
  async ({ event, context }) => {
    const eventId = createEventId(event);

    const entity: CommitmentTreeRoot = {
      id: eventId,
      root: event.params.root,
      blockNumber: BigInt(event.block.number),
      logIndex: event.logIndex,
      txHash: event.transaction.hash,
      timestamp: BigInt(event.block.timestamp),
      chainId: BigInt(event.chainId),
    };

    context.CommitmentTreeRoot.set(entity);

    // Update stats
    await incrementAllStats(context, event.chainId, event.block.number, event.block.timestamp, {
      commitmentRoots: 1,
    });
  }
);

// ============================================
// ForwarderCallExecuted Handler
// ============================================

indexer.onEvent(
  { contract: "ProtocolAdapter", event: "ForwarderCallExecuted" },
  async ({ event, context }) => {
    const eventId = createEventId(event);

    const entity: ForwarderCall = {
      id: eventId,
      untrustedForwarder: event.params.untrustedForwarder,
      input: event.params.input,
      output: event.params.output,
      blockNumber: BigInt(event.block.number),
      txHash: event.transaction.hash,
      timestamp: BigInt(event.block.timestamp),
      chainId: BigInt(event.chainId),
    };

    context.ForwarderCall.set(entity);

    await incrementAllStats(context, event.chainId, event.block.number, event.block.timestamp, {
      forwarderCalls: 1,
    });
  }
);

// ============================================
// OwnershipTransferred Handler
// ============================================

indexer.onEvent(
  { contract: "ProtocolAdapter", event: "OwnershipTransferred" },
  // eslint-disable-next-line @typescript-eslint/require-await -- onEvent handlers are typed => Promise<void>; this one does only sync entity writes
  async ({ event, context }) => {
    const eventId = createEventId(event);

    const entity: OwnershipTransferred = {
      id: eventId,
      previousOwner: event.params.previousOwner,
      newOwner: event.params.newOwner,
      blockNumber: BigInt(event.block.number),
      txHash: event.transaction.hash,
      timestamp: BigInt(event.block.timestamp),
      chainId: BigInt(event.chainId),
    };

    context.OwnershipTransferred.set(entity);
  }
);

// ============================================
// Paused / Unpaused Handlers
// ============================================

// eslint-disable-next-line @typescript-eslint/require-await -- onEvent handlers are typed => Promise<void>; this one does only sync entity writes
indexer.onEvent({ contract: "ProtocolAdapter", event: "Paused" }, async ({ event, context }) => {
  const eventId = createEventId(event);

  const entity: ProtocolAdapterPaused = {
    id: eventId,
    account: event.params.account,
    paused: true,
    blockNumber: BigInt(event.block.number),
    txHash: event.transaction.hash,
    timestamp: BigInt(event.block.timestamp),
    chainId: BigInt(event.chainId),
  };

  context.ProtocolAdapterPaused.set(entity);
});

// eslint-disable-next-line @typescript-eslint/require-await -- onEvent handlers are typed => Promise<void>; this one does only sync entity writes
indexer.onEvent({ contract: "ProtocolAdapter", event: "Unpaused" }, async ({ event, context }) => {
  const eventId = createEventId(event);

  const entity: ProtocolAdapterPaused = {
    id: eventId,
    account: event.params.account,
    paused: false,
    blockNumber: BigInt(event.block.number),
    txHash: event.transaction.hash,
    timestamp: BigInt(event.block.timestamp),
    chainId: BigInt(event.chainId),
  };

  context.ProtocolAdapterPaused.set(entity);
});
