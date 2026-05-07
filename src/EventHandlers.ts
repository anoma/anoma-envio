/**
 * Event handlers for Anoma Protocol Adapter events.
 *
 * PA-EVM Event Order (within same EVM transaction):
 * 1. ResourcePayload/DiscoveryPayload/ExternalPayload/ApplicationPayload (per resource)
 * 2. ForwarderCallExecuted (if external calls exist)
 * 3. CommitmentTreeRootAdded
 * 4. ActionExecuted (per action)
 * 5. TransactionExecuted (once at the end)
 *
 * Tag Index Convention (from TransactionExecuted):
 * - Even indices (0, 2, 4...): consumed resources (nullifiers)
 * - Odd indices (1, 3, 5...): created resources (commitments)
 */

import {
  ProtocolAdapter,
  EVMTransaction,
  Transaction,
  Tag,
  Action,
  ComplianceUnit,
  LogicInput,
  LogicRef,
  Payload,
  CommitmentTreeRoot,
  ForwarderCall,
  Stats,
  DailyStats,
  handlerContext,
  ProtocolAdapter_TransactionExecuted_event,
  ProtocolAdapter_ActionExecuted_event,
  ProtocolAdapter_ResourcePayload_event,
  ProtocolAdapter_DiscoveryPayload_event,
  ProtocolAdapter_ExternalPayload_event,
  ProtocolAdapter_ApplicationPayload_event,
  ProtocolAdapter_CommitmentTreeRootAdded_event,
  ProtocolAdapter_ForwarderCallExecuted_event,
} from "generated";

import { decodeExecuteCalldata, isExecuteCalldata } from "./decoders/ActionDecoder";
import { DeletionCriterion, type Action as DecodedAction } from "./types";
import { BoundedCache } from "./utils/BoundedCache";
import { DECODED_CALLDATA_CACHE_MAX_SIZE, isConsumedIndex, getUTCDay } from "./constants";

// ============================================
// Type Aliases
// ============================================

type TransactionExecutedArgs = {
  event: ProtocolAdapter_TransactionExecuted_event;
  context: handlerContext;
};

type ActionExecutedArgs = {
  event: ProtocolAdapter_ActionExecuted_event;
  context: handlerContext;
};

type ResourcePayloadArgs = {
  event: ProtocolAdapter_ResourcePayload_event;
  context: handlerContext;
};

type DiscoveryPayloadArgs = {
  event: ProtocolAdapter_DiscoveryPayload_event;
  context: handlerContext;
};

type ExternalPayloadArgs = {
  event: ProtocolAdapter_ExternalPayload_event;
  context: handlerContext;
};

type ApplicationPayloadArgs = {
  event: ProtocolAdapter_ApplicationPayload_event;
  context: handlerContext;
};

type CommitmentTreeRootAddedArgs = {
  event: ProtocolAdapter_CommitmentTreeRootAdded_event;
  context: handlerContext;
};

type ForwarderCallExecutedArgs = {
  event: ProtocolAdapter_ForwarderCallExecuted_event;
  context: handlerContext;
};

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
 * Creates a compliance unit identifier.
 */
function createComplianceUnitId(actionId: string, index: number): string {
  return `${actionId}_compliance_${index}`;
}

/**
 * Creates a logic input identifier.
 */
function createLogicInputId(actionId: string, index: number): string {
  return `${actionId}_logic_${index}`;
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
function getDecodedTransaction(
  txHash: string,
  input: string | undefined
): {
  actions: DecodedAction[];
  deltaProof: string;
  aggregationProof: string;
} | null {
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
// Pending Action IDs Cache
// ============================================
// Tracks action entity IDs created by ActionExecuted so that the subsequent
// TransactionExecuted handler can retroactively update their transaction_id
// from the temporary evmTxId to the unique txId (which includes logIndex).
// Keyed by evmTxId; consumed and cleared on each TransactionExecuted.
const pendingActionIds = new BoundedCache<string, string[]>(DECODED_CALLDATA_CACHE_MAX_SIZE);

// ============================================
// Stats Singleton
// ============================================
const STATS_ID = "global";

/**
 * Gets the current stats or creates a new one with zero counts.
 */
async function getOrCreateStats(context: handlerContext): Promise<Stats> {
  const existing = await context.Stats.get(STATS_ID);
  if (existing) {
    return existing;
  }
  return {
    id: STATS_ID,
    transactions: 0,
    tags: 0,
    tagsConsumed: 0,
    tagsCreated: 0,
    actions: 0,
    complianceUnits: 0,
    logicInputs: 0,
    commitmentRoots: 0,
    distinctLogics: 0,
    externalCalls: 0,
    forwarderCalls: 0,
    resourcePayloads: 0,
    discoveryPayloads: 0,
    applicationPayloads: 0,
    lastUpdatedBlock: 0,
    lastUpdatedTimestamp: 0,
  };
}

/**
 * Updates stats with increments and saves to context.
 */
async function incrementStats(
  context: handlerContext,
  blockNumber: number,
  timestamp: number,
  increments: {
    transactions?: number;
    tags?: number;
    tagsConsumed?: number;
    tagsCreated?: number;
    actions?: number;
    complianceUnits?: number;
    logicInputs?: number;
    commitmentRoots?: number;
    distinctLogics?: number;
    externalCalls?: number;
    forwarderCalls?: number;
    resourcePayloads?: number;
    discoveryPayloads?: number;
    applicationPayloads?: number;
  }
): Promise<void> {
  const stats = await getOrCreateStats(context);
  const updated: Stats = {
    ...stats,
    transactions: stats.transactions + (increments.transactions || 0),
    tags: stats.tags + (increments.tags || 0),
    tagsConsumed: stats.tagsConsumed + (increments.tagsConsumed || 0),
    tagsCreated: stats.tagsCreated + (increments.tagsCreated || 0),
    actions: stats.actions + (increments.actions || 0),
    complianceUnits: stats.complianceUnits + (increments.complianceUnits || 0),
    logicInputs: stats.logicInputs + (increments.logicInputs || 0),
    commitmentRoots: stats.commitmentRoots + (increments.commitmentRoots || 0),
    distinctLogics: stats.distinctLogics + (increments.distinctLogics || 0),
    externalCalls: stats.externalCalls + (increments.externalCalls || 0),
    forwarderCalls: stats.forwarderCalls + (increments.forwarderCalls || 0),
    resourcePayloads: stats.resourcePayloads + (increments.resourcePayloads || 0),
    discoveryPayloads: stats.discoveryPayloads + (increments.discoveryPayloads || 0),
    applicationPayloads: stats.applicationPayloads + (increments.applicationPayloads || 0),
    lastUpdatedBlock: blockNumber,
    lastUpdatedTimestamp: timestamp,
  };
  context.Stats.set(updated);
}

// ============================================
// DailyStats (per-day bucketing)
// ============================================

/**
 * Gets the current daily stats for the given timestamp or creates a new one with zero counts.
 */
async function getOrCreateDailyStats(
  context: handlerContext,
  timestamp: number
): Promise<DailyStats> {
  const { dateKey, dayTimestamp } = getUTCDay(timestamp);
  const existing = await context.DailyStats.get(dateKey);
  if (existing) {
    return existing;
  }
  return {
    id: dateKey,
    dayTimestamp,
    transactions: 0,
    tags: 0,
    tagsConsumed: 0,
    tagsCreated: 0,
    actions: 0,
    complianceUnits: 0,
    logicInputs: 0,
    commitmentRoots: 0,
    externalCalls: 0,
    forwarderCalls: 0,
    resourcePayloads: 0,
    discoveryPayloads: 0,
    applicationPayloads: 0,
    lastUpdatedBlock: 0,
    lastUpdatedTimestamp: 0,
  };
}

/**
 * Updates daily stats with increments and saves to context.
 * Same as incrementStats but keyed by UTC day. Ignores distinctLogics.
 */
async function incrementDailyStats(
  context: handlerContext,
  blockNumber: number,
  timestamp: number,
  increments: {
    transactions?: number;
    tags?: number;
    tagsConsumed?: number;
    tagsCreated?: number;
    actions?: number;
    complianceUnits?: number;
    logicInputs?: number;
    commitmentRoots?: number;
    externalCalls?: number;
    forwarderCalls?: number;
    resourcePayloads?: number;
    discoveryPayloads?: number;
    applicationPayloads?: number;
  }
): Promise<void> {
  const daily = await getOrCreateDailyStats(context, timestamp);
  const updated: DailyStats = {
    ...daily,
    transactions: daily.transactions + (increments.transactions || 0),
    tags: daily.tags + (increments.tags || 0),
    tagsConsumed: daily.tagsConsumed + (increments.tagsConsumed || 0),
    tagsCreated: daily.tagsCreated + (increments.tagsCreated || 0),
    actions: daily.actions + (increments.actions || 0),
    complianceUnits: daily.complianceUnits + (increments.complianceUnits || 0),
    logicInputs: daily.logicInputs + (increments.logicInputs || 0),
    commitmentRoots: daily.commitmentRoots + (increments.commitmentRoots || 0),
    externalCalls: daily.externalCalls + (increments.externalCalls || 0),
    forwarderCalls: daily.forwarderCalls + (increments.forwarderCalls || 0),
    resourcePayloads: daily.resourcePayloads + (increments.resourcePayloads || 0),
    discoveryPayloads: daily.discoveryPayloads + (increments.discoveryPayloads || 0),
    applicationPayloads: daily.applicationPayloads + (increments.applicationPayloads || 0),
    lastUpdatedBlock: blockNumber,
    lastUpdatedTimestamp: timestamp,
  };
  context.DailyStats.set(updated);
}

/**
 * Unified helper: increments both global Stats and per-day DailyStats.
 * All handler call sites use this instead of calling incrementStats directly.
 */
async function incrementAllStats(
  context: handlerContext,
  blockNumber: number,
  timestamp: number,
  increments: {
    transactions?: number;
    tags?: number;
    tagsConsumed?: number;
    tagsCreated?: number;
    actions?: number;
    complianceUnits?: number;
    logicInputs?: number;
    commitmentRoots?: number;
    distinctLogics?: number;
    externalCalls?: number;
    forwarderCalls?: number;
    resourcePayloads?: number;
    discoveryPayloads?: number;
    applicationPayloads?: number;
  }
): Promise<void> {
  await incrementStats(context, blockNumber, timestamp, increments);
  await incrementDailyStats(context, blockNumber, timestamp, increments);
}

// ============================================
// TransactionExecuted Handler
// ============================================
// This event fires LAST in the transaction, after all payload events.
// It provides the authoritative list of tags and their consumed/created status.

ProtocolAdapter.TransactionExecuted.handler(async ({ event, context }: TransactionExecutedArgs) => {
  // Cast transaction to access EVM fields
  const tx = event.transaction as {
    hash: string;
    input?: string;
    from?: string;
    value?: bigint;
  };

  const evmTxId = createEvmTxId(event.chainId, tx.hash);
  const txId = createTransactionId(event.chainId, tx.hash, event.logIndex);
  const txHash = tx.hash;

  // Try to decode calldata for proofs
  // Note: event.transaction.input is available because we added "input" to field_selection
  const decoded = getDecodedTransaction(txHash, tx.input);

  // Create EVMTransaction entity (the carrier/wrapper, shared by all AP txs in this EVM tx)
  const evmTxEntity: EVMTransaction = {
    id: evmTxId,
    txHash: txHash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    chainId: event.chainId,
    from: tx.from,
    value: tx.value,
  };

  context.EVMTransaction.set(evmTxEntity);

  // Create Transaction entity (Anoma Transaction payload — unique per AP tx)
  const txEntity: Transaction = {
    id: txId,
    logIndex: event.logIndex,
    contractAddress: event.srcAddress,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    chainId: event.chainId,
    tagHashes: event.params.tags,
    logicRefs: event.params.logicRefs,
    deltaProof: decoded?.deltaProof,
    aggregationProof: decoded?.aggregationProof,
    evmTransaction_id: evmTxId,
  };

  context.Transaction.set(txEntity);

  // Retroactively update Actions created by earlier ActionExecuted events
  // so their transaction_id points to this Transaction (not the temporary evmTxId)
  const actionIds = pendingActionIds.get(evmTxId) || [];
  for (const actionId of actionIds) {
    const action = await context.Action.get(actionId);
    if (action) {
      context.Action.set({ ...action, transaction_id: txId });
    }
  }
  pendingActionIds.delete(evmTxId);

  // Build a map from nullifier/commitment to compliance unit ID for linking resources
  // This requires looking at all compliance units from all actions
  const nullifierToComplianceUnit = new Map<string, string>();
  const commitmentToComplianceUnit = new Map<string, string>();
  const tagToLogicInput = new Map<string, string>();

  if (decoded) {
    for (let actionIndex = 0; actionIndex < decoded.actions.length; actionIndex++) {
      const action = decoded.actions[actionIndex];
      // We need to find the action ID - it's based on actionTreeRoot which we can compute
      // For now, we'll iterate through actions and match by index
      // The ActionExecuted events have already created Action entities

      // Get all actions for this transaction to find the matching actionId
      // Since we can't easily query by transaction here, we'll construct the ID
      // based on the pattern used in ActionExecuted handler

      // Compliance units
      for (let cuIndex = 0; cuIndex < action.complianceVerifierInputs.length; cuIndex++) {
        const cu = action.complianceVerifierInputs[cuIndex];
        // We need the actionId to construct compliance unit ID
        // The ActionExecuted handler uses: `${txId}_${actionTreeRoot}`
        // We don't have actionTreeRoot here directly, so we'll use action index
        // This means we need to update how we track this...

        // For now, store by nullifier/commitment directly
        nullifierToComplianceUnit.set(
          cu.instance.consumed.nullifier.toLowerCase(),
          `action_${actionIndex}_compliance_${cuIndex}`
        );
        commitmentToComplianceUnit.set(
          cu.instance.created.commitment.toLowerCase(),
          `action_${actionIndex}_compliance_${cuIndex}`
        );
      }

      // Logic inputs - map tag to logic input
      for (let liIndex = 0; liIndex < action.logicVerifierInputs.length; liIndex++) {
        const li = action.logicVerifierInputs[liIndex];
        tagToLogicInput.set(li.tag.toLowerCase(), `action_${actionIndex}_logic_${liIndex}`);
      }
    }
  }

  // Update/Create Tag entities for each tag hash
  // Tags are in alternating order: consumed (nullifier), created (commitment), ...
  for (let index = 0; index < event.params.tags.length; index++) {
    const tagHash = event.params.tags[index];
    const isConsumed = isConsumedIndex(index);
    const tagId = createTagId(event.chainId, tagHash);
    const logicRef = event.params.logicRefs[index];

    // Find linked compliance unit and logic input
    // Note: complianceUnit_id will be set by ActionExecuted handler
    // We use isConsumed to determine which side of the compliance unit this tag is on
    let complianceUnit_id: string | undefined;
    let logicInput_id: string | undefined;

    // Check if tag already exists (created by earlier ResourcePayload event)
    const existingTag = await context.Tag.get(tagId);

    if (existingTag) {
      // Update existing tag with authoritative isConsumed and index from TransactionExecuted
      const updatedTag: Tag = {
        ...existingTag,
        index: index,
        isConsumed: isConsumed,
        transaction_id: txId,
        logicRef: logicRef || existingTag.logicRef,
        // Keep existing links if already set
        logicInput_id: existingTag.logicInput_id || logicInput_id,
        complianceUnit_id: existingTag.complianceUnit_id || complianceUnit_id,
      };
      context.Tag.set(updatedTag);
    } else {
      // Create new tag (ResourcePayload may not have fired yet or at all)
      const tagEntity: Tag = {
        id: tagId,
        tagHash: tagHash,
        index: index,
        isConsumed: isConsumed,
        blockNumber: event.block.number,
        chainId: event.chainId,
        transaction_id: txId,
        logicRef: logicRef || undefined,
        logicInput_id: logicInput_id,
        complianceUnit_id: complianceUnit_id,
      };
      context.Tag.set(tagEntity);
    }
  }

  // Track distinct logicRefs
  const uniqueLogicRefs = [...new Set(event.params.logicRefs)];
  let newLogicCount = 0;

  for (const logicRef of uniqueLogicRefs) {
    const existing = await context.LogicRef.get(logicRef);
    if (!existing) {
      const logicRefEntity: LogicRef = {
        id: logicRef,
        firstSeenBlock: event.block.number,
        firstSeenTimestamp: event.block.timestamp,
        firstSeenChainId: event.chainId,
        firstSeenTxHash: txHash,
      };
      context.LogicRef.set(logicRefEntity);
      newLogicCount++;
    }
  }

  // Update global stats
  const totalTags = event.params.tags.length;
  const consumedCount = Math.floor(totalTags / 2);
  const createdCount = totalTags - consumedCount;

  await incrementAllStats(context, event.block.number, event.block.timestamp, {
    transactions: 1,
    tags: totalTags,
    tagsConsumed: consumedCount,
    tagsCreated: createdCount,
    distinctLogics: newLogicCount,
  });

  // Clear the cache after processing is complete
  clearDecodedCache(txHash);
});

// ============================================
// ActionExecuted Handler
// ============================================
// ActionExecuted fires BEFORE TransactionExecuted but AFTER payload events.
// We decode the calldata here to create ComplianceUnit and LogicInput entities.

ProtocolAdapter.ActionExecuted.handler(async ({ event, context }: ActionExecutedArgs) => {
  const evmTxId = createEvmTxId(event.chainId, event.transaction.hash);
  const txHash = event.transaction.hash;
  // Use evmTxId + actionTreeRoot for unique action ID since multiple actions can be in one tx
  const actionId = `${evmTxId}_${event.params.actionTreeRoot}`;

  // Try to decode calldata to get action details
  const txInput = (event.transaction as { hash: string; input?: string }).input;
  const decoded = getDecodedTransaction(txHash, txInput);

  // Find which action index this is by matching actionTreeRoot
  // For now, we'll try to match by index since we process actions in order
  let actionIndex = 0;
  let decodedAction: DecodedAction | null = null;

  if (decoded) {
    // Try to find the action by comparing actionTreeRoot
    // The actionTreeRoot is computed from the action data
    // Since we can't easily compute it here, we'll use the order of ActionExecuted events
    // by tracking how many we've seen for this transaction

    // Simple approach: assume actions are processed in order
    // Count existing actions for this transaction
    // Note: This is a limitation - we're assuming sequential processing
    // A more robust solution would compute the actionTreeRoot from decoded data

    // For now, we'll iterate and pick the first action that hasn't been assigned
    // Since ActionExecuted events come in order, this should work
    for (let i = 0; i < decoded.actions.length; i++) {
      const potentialAction = decoded.actions[i];
      // Check if this action's tag count matches
      if (potentialAction.logicVerifierInputs.length === Number(event.params.actionTagCount)) {
        // Likely match - use this action
        decodedAction = potentialAction;
        actionIndex = i;
        break;
      }
    }

    // If no match by tag count, just use index 0 (fallback)
    if (!decodedAction && decoded.actions.length > 0) {
      decodedAction = decoded.actions[0];
      actionIndex = 0;
    }
  }

  // Create Action entity (transaction_id is temporary — TransactionExecuted will fix it)
  const actionEntity: Action = {
    id: actionId,
    index: actionIndex,
    actionTreeRoot: event.params.actionTreeRoot,
    actionTagCount: Number(event.params.actionTagCount),
    blockNumber: event.block.number,
    chainId: event.chainId,
    timestamp: event.block.timestamp,
    transaction_id: evmTxId,
  };

  context.Action.set(actionEntity);

  // Track this action for retroactive transaction_id update by TransactionExecuted
  const pending = pendingActionIds.get(evmTxId) || [];
  pending.push(actionId);
  pendingActionIds.set(evmTxId, pending);

  // Create ComplianceUnit entities from decoded action
  if (decodedAction) {
    for (let cuIndex = 0; cuIndex < decodedAction.complianceVerifierInputs.length; cuIndex++) {
      const cu = decodedAction.complianceVerifierInputs[cuIndex];
      const complianceUnitId = createComplianceUnitId(actionId, cuIndex);

      // Find tags by nullifier/commitment
      const consumedTagId = createTagId(event.chainId, cu.instance.consumed.nullifier);
      const createdTagId = createTagId(event.chainId, cu.instance.created.commitment);

      // Try to get existing tags to link
      const consumedTag = await context.Tag.get(consumedTagId);
      const createdTag = await context.Tag.get(createdTagId);

      const complianceEntity: ComplianceUnit = {
        id: complianceUnitId,
        index: cuIndex,
        proof: cu.proof || undefined,
        consumedNullifier: cu.instance.consumed.nullifier,
        consumedLogicRef: cu.instance.consumed.logicRef,
        consumedCommitmentTreeRoot: cu.instance.consumed.commitmentTreeRoot,
        createdCommitment: cu.instance.created.commitment,
        createdLogicRef: cu.instance.created.logicRef,
        unitDeltaX: cu.instance.unitDeltaX,
        unitDeltaY: cu.instance.unitDeltaY,
        action_id: actionId,
        consumedTag_id: consumedTag ? consumedTagId : undefined,
        createdTag_id: createdTag ? createdTagId : undefined,
      };

      context.ComplianceUnit.set(complianceEntity);

      // Update tags with compliance unit link if they exist
      // The isConsumed field on the tag determines which side of the unit it's on
      if (consumedTag) {
        const updatedTag: Tag = {
          ...consumedTag,
          complianceUnit_id: complianceUnitId,
        };
        context.Tag.set(updatedTag);
      }

      if (createdTag) {
        const updatedTag: Tag = {
          ...createdTag,
          complianceUnit_id: complianceUnitId,
        };
        context.Tag.set(updatedTag);
      }
    }

    // Create LogicInput entities from decoded action
    for (let liIndex = 0; liIndex < decodedAction.logicVerifierInputs.length; liIndex++) {
      const li = decodedAction.logicVerifierInputs[liIndex];
      const logicInputId = createLogicInputId(actionId, liIndex);

      // Determine if consumed based on index (even = consumed, odd = created)
      const isConsumed = isConsumedIndex(liIndex);

      // Find tag by tag hash
      const tagId = createTagId(event.chainId, li.tag);
      const existingTag = await context.Tag.get(tagId);

      const logicEntity: LogicInput = {
        id: logicInputId,
        index: liIndex,
        tagHash: li.tag,
        verifyingKey: li.verifyingKey,
        isConsumed: isConsumed,
        proof: li.proof || undefined,
        resourcePayloadCount: li.appData.resourcePayload.length,
        discoveryPayloadCount: li.appData.discoveryPayload.length,
        externalPayloadCount: li.appData.externalPayload.length,
        applicationPayloadCount: li.appData.applicationPayload.length,
        action_id: actionId,
        tag_id: existingTag ? tagId : undefined,
      };

      context.LogicInput.set(logicEntity);

      // Create Payload entities for external payloads from decoded calldata
      for (let epIdx = 0; epIdx < li.appData.externalPayload.length; epIdx++) {
        const ep = li.appData.externalPayload[epIdx];
        const payloadId = `${logicInputId}_externalCall_${epIdx}`;

        context.Payload.set({
          id: payloadId,
          category: "externalCall",
          tagHash: li.tag,
          index: epIdx,
          blob: ep.blob,
          deletionCriterion:
            ep.deletionCriterion === DeletionCriterion.Immediately ? "immediately" : "never",
          tag_id: tagId,
        });
      }

      // Update tag with logic input link if it exists
      if (existingTag) {
        const updatedTag: Tag = {
          ...existingTag,
          logicInput_id: logicInputId,
        };
        context.Tag.set(updatedTag);
      }
    }

    // Update stats for compliance units and logic inputs from this action
    await incrementAllStats(context, event.block.number, event.block.timestamp, {
      actions: 1,
      complianceUnits: decodedAction.complianceVerifierInputs.length,
      logicInputs: decodedAction.logicVerifierInputs.length,
    });
  } else {
    // No decoded action data - just count the action itself
    await incrementAllStats(context, event.block.number, event.block.timestamp, {
      actions: 1,
    });
  }
});

// ============================================
// ResourcePayload Handler
// ============================================
// ResourcePayload fires BEFORE TransactionExecuted.
// Creates a Payload entity with category "resource" and creates/updates the Tag entity.

ProtocolAdapter.ResourcePayload.handler(async ({ event, context }: ResourcePayloadArgs) => {
  const tagId = createTagId(event.chainId, event.params.tag);
  const evmTxId = createEvmTxId(event.chainId, event.transaction.hash);

  // Create Payload entity with category "resource" (unified with other payload types)
  const payloadEntity = createPayloadEntity(event, "resource");
  context.Payload.set(payloadEntity);

  // Update stats
  await incrementAllStats(context, event.block.number, event.block.timestamp, {
    resourcePayloads: 1,
  });

  // Create/update Tag entity (without blob fields — blob data lives in Payload)
  const existingTag = await context.Tag.get(tagId);

  if (existingTag) {
    // Tag already exists — no blob fields to update anymore
    // logicRef comes from TransactionExecuted, not from blob decoding
  } else {
    // Create new tag - isConsumed will be updated by TransactionExecuted
    const tagEntity: Tag = {
      id: tagId,
      tagHash: event.params.tag,
      index: 0, // Placeholder - will be set by TransactionExecuted
      isConsumed: false, // Placeholder - will be set correctly by TransactionExecuted
      blockNumber: event.block.number,
      chainId: event.chainId,
      transaction_id: evmTxId, // Temporary — TransactionExecuted will set the proper txId
      logicRef: undefined, // Will be set by TransactionExecuted
      logicInput_id: undefined,
      complianceUnit_id: undefined,
    };
    context.Tag.set(tagEntity);
  }
});

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
    deletionCriterion: undefined, // Would need to decode from blob structure
    tag_id: tagId,
  };
}

ProtocolAdapter.DiscoveryPayload.handler(async ({ event, context }: DiscoveryPayloadArgs) => {
  const entity = createPayloadEntity(event, "discovery");
  context.Payload.set(entity);

  await incrementAllStats(context, event.block.number, event.block.timestamp, {
    discoveryPayloads: 1,
  });
});

ProtocolAdapter.ExternalPayload.handler(async ({ event, context }: ExternalPayloadArgs) => {
  const entity = createPayloadEntity(event, "externalCall");
  context.Payload.set(entity);

  await incrementAllStats(context, event.block.number, event.block.timestamp, {
    externalCalls: 1,
  });
});

ProtocolAdapter.ApplicationPayload.handler(async ({ event, context }: ApplicationPayloadArgs) => {
  const entity = createPayloadEntity(event, "application");
  context.Payload.set(entity);

  await incrementAllStats(context, event.block.number, event.block.timestamp, {
    applicationPayloads: 1,
  });
});

// ============================================
// CommitmentTreeRootAdded Handler
// ============================================

ProtocolAdapter.CommitmentTreeRootAdded.handler(
  async ({ event, context }: CommitmentTreeRootAddedArgs) => {
    const eventId = createEventId(event);

    const entity: CommitmentTreeRoot = {
      id: eventId,
      root: event.params.root,
      blockNumber: event.block.number,
      logIndex: event.logIndex,
      txHash: event.transaction.hash,
      timestamp: event.block.timestamp,
      chainId: event.chainId,
    };

    context.CommitmentTreeRoot.set(entity);

    // Update stats
    await incrementAllStats(context, event.block.number, event.block.timestamp, {
      commitmentRoots: 1,
    });
  }
);

// ============================================
// ForwarderCallExecuted Handler
// ============================================

ProtocolAdapter.ForwarderCallExecuted.handler(
  async ({ event, context }: ForwarderCallExecutedArgs) => {
    const eventId = createEventId(event);

    const entity: ForwarderCall = {
      id: eventId,
      untrustedForwarder: event.params.untrustedForwarder,
      input: event.params.input,
      output: event.params.output,
      blockNumber: event.block.number,
      txHash: event.transaction.hash,
      timestamp: event.block.timestamp,
      chainId: event.chainId,
    };

    context.ForwarderCall.set(entity);

    await incrementAllStats(context, event.block.number, event.block.timestamp, {
      forwarderCalls: 1,
    });
  }
);
