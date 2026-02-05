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
  Resource,
  Action,
  ComplianceUnit,
  LogicInput,
  Payload,
  CommitmentTreeRoot,
  ForwarderCall,
  Stats,
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

import { safeDecodeResourceBlob } from "./decoders/ResourceDecoder";
import { decodeExecuteCalldata, isExecuteCalldata } from "./decoders/ActionDecoder";
import type { Action as DecodedAction } from "./types";
import { BoundedCache } from "./utils/BoundedCache";
import { DECODED_CALLDATA_CACHE_MAX_SIZE, isConsumedIndex } from "./constants";

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
 * Creates a transaction identifier using the EVM transaction hash.
 * All events within the same EVM transaction share the same hash,
 * allowing proper correlation between TransactionExecuted, ResourcePayload, etc.
 */
function createTransactionId(chainId: number, txHash: string): string {
  return `${chainId}_${txHash}`;
}

/**
 * Creates a resource identifier from chain and tag.
 * Tags are globally unique (cryptographic commitments/nullifiers).
 */
function createResourceId(chainId: number, tag: string): string {
  return `${chainId}_${tag}_resource`;
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
    resources: 0,
    resourcesConsumed: 0,
    resourcesCreated: 0,
    actions: 0,
    complianceUnits: 0,
    logicInputs: 0,
    commitmentRoots: 0,
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
    resources?: number;
    resourcesConsumed?: number;
    resourcesCreated?: number;
    actions?: number;
    complianceUnits?: number;
    logicInputs?: number;
    commitmentRoots?: number;
  }
): Promise<void> {
  const stats = await getOrCreateStats(context);
  const updated: Stats = {
    ...stats,
    transactions: stats.transactions + (increments.transactions || 0),
    resources: stats.resources + (increments.resources || 0),
    resourcesConsumed: stats.resourcesConsumed + (increments.resourcesConsumed || 0),
    resourcesCreated: stats.resourcesCreated + (increments.resourcesCreated || 0),
    actions: stats.actions + (increments.actions || 0),
    complianceUnits: stats.complianceUnits + (increments.complianceUnits || 0),
    logicInputs: stats.logicInputs + (increments.logicInputs || 0),
    commitmentRoots: stats.commitmentRoots + (increments.commitmentRoots || 0),
    lastUpdatedBlock: blockNumber,
    lastUpdatedTimestamp: timestamp,
  };
  context.Stats.set(updated);
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
    gas?: bigint;
    gasPrice?: bigint;
    gasUsed?: bigint;
    value?: bigint;
  };

  const txId = createTransactionId(event.chainId, tx.hash);
  const txHash = tx.hash;

  // Try to decode calldata for proofs
  // Note: event.transaction.input is available because we added "input" to field_selection
  const decoded = getDecodedTransaction(txHash, tx.input);

  // Create EVMTransaction entity (the carrier/wrapper)
  const evmTxEntity: EVMTransaction = {
    id: txId,
    txHash: txHash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    chainId: event.chainId,
    from: tx.from,
    value: tx.value,
    gasPrice: tx.gasPrice,
    gas: tx.gas,
    gasUsed: tx.gasUsed,
  };

  context.EVMTransaction.set(evmTxEntity);

  // Create Transaction entity (Anoma Transaction payload)
  const txEntity: Transaction = {
    id: txId,
    logIndex: event.logIndex,
    contractAddress: event.srcAddress,
    tags: event.params.tags,
    logicRefs: event.params.logicRefs,
    deltaProof: decoded?.deltaProof,
    aggregationProof: decoded?.aggregationProof,
    evmTransaction_id: txId,
  };

  context.Transaction.set(txEntity);

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

  // Update/Create Resource entities for each tag
  // Tags are in alternating order: consumed (nullifier), created (commitment), ...
  for (let index = 0; index < event.params.tags.length; index++) {
    const tag = event.params.tags[index];
    const isConsumed = isConsumedIndex(index);
    const resourceId = createResourceId(event.chainId, tag);
    const logicRef = event.params.logicRefs[index];
    const _tagLower = tag.toLowerCase();

    // Find linked compliance unit and logic input
    // Note: complianceUnit_id will be set by ActionExecuted handler
    // We use isConsumed to determine which side of the compliance unit this resource is on
    let complianceUnit_id: string | undefined;
    let logicInput_id: string | undefined;

    // Check if resource already exists (created by earlier ResourcePayload event)
    const existingResource = await context.Resource.get(resourceId);

    if (existingResource) {
      // Update existing resource with authoritative isConsumed and index from TransactionExecuted
      const updatedResource: Resource = {
        ...existingResource,
        index: index,
        isConsumed: isConsumed,
        transaction_id: txId,
        logicRef: logicRef || existingResource.logicRef,
        // Keep existing links if already set
        logicInput_id: existingResource.logicInput_id || logicInput_id,
        complianceUnit_id: existingResource.complianceUnit_id || complianceUnit_id,
      };
      context.Resource.set(updatedResource);
    } else {
      // Create new resource (ResourcePayload may not have fired yet or at all)
      const resourceEntity: Resource = {
        id: resourceId,
        tag: tag,
        index: index,
        blobIndex: undefined,
        isConsumed: isConsumed,
        blockNumber: event.block.number,
        chainId: event.chainId,
        rawBlob: "",
        decodingStatus: "pending",
        decodingError: undefined,
        transaction_id: txId,
        logicRef: logicRef || undefined,
        logicInput_id: logicInput_id,
        complianceUnit_id: complianceUnit_id,
      };
      context.Resource.set(resourceEntity);
    }
  }

  // Update global stats
  const totalResources = event.params.tags.length;
  const consumedCount = Math.floor(totalResources / 2);
  const createdCount = totalResources - consumedCount;

  await incrementStats(context, event.block.number, event.block.timestamp, {
    transactions: 1,
    resources: totalResources,
    resourcesConsumed: consumedCount,
    resourcesCreated: createdCount,
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
  const txId = createTransactionId(event.chainId, event.transaction.hash);
  const txHash = event.transaction.hash;
  // Use txHash + actionTreeRoot for unique action ID since multiple actions can be in one tx
  const actionId = `${txId}_${event.params.actionTreeRoot}`;

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

  // Create Action entity
  const actionEntity: Action = {
    id: actionId,
    index: actionIndex,
    actionTreeRoot: event.params.actionTreeRoot,
    tagCount: Number(event.params.actionTagCount),
    blockNumber: event.block.number,
    chainId: event.chainId,
    timestamp: event.block.timestamp,
    transaction_id: txId,
  };

  context.Action.set(actionEntity);

  // Create ComplianceUnit entities from decoded action
  if (decodedAction) {
    for (let cuIndex = 0; cuIndex < decodedAction.complianceVerifierInputs.length; cuIndex++) {
      const cu = decodedAction.complianceVerifierInputs[cuIndex];
      const complianceUnitId = createComplianceUnitId(actionId, cuIndex);

      // Find resources by nullifier/commitment
      const consumedResourceId = createResourceId(event.chainId, cu.instance.consumed.nullifier);
      const createdResourceId = createResourceId(event.chainId, cu.instance.created.commitment);

      // Try to get existing resources to link
      const consumedResource = await context.Resource.get(consumedResourceId);
      const createdResource = await context.Resource.get(createdResourceId);

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
        consumedResource_id: consumedResource ? consumedResourceId : undefined,
        createdResource_id: createdResource ? createdResourceId : undefined,
      };

      context.ComplianceUnit.set(complianceEntity);

      // Update resources with compliance unit link if they exist
      // The isConsumed field on the resource determines which side of the unit it's on
      if (consumedResource) {
        const updatedResource: Resource = {
          ...consumedResource,
          complianceUnit_id: complianceUnitId,
        };
        context.Resource.set(updatedResource);
      }

      if (createdResource) {
        const updatedResource: Resource = {
          ...createdResource,
          complianceUnit_id: complianceUnitId,
        };
        context.Resource.set(updatedResource);
      }
    }

    // Create LogicInput entities from decoded action
    for (let liIndex = 0; liIndex < decodedAction.logicVerifierInputs.length; liIndex++) {
      const li = decodedAction.logicVerifierInputs[liIndex];
      const logicInputId = createLogicInputId(actionId, liIndex);

      // Determine if consumed based on index (even = consumed, odd = created)
      const isConsumed = isConsumedIndex(liIndex);

      // Find resource by tag
      const resourceId = createResourceId(event.chainId, li.tag);
      const resource = await context.Resource.get(resourceId);

      const logicEntity: LogicInput = {
        id: logicInputId,
        index: liIndex,
        tag: li.tag,
        logicRef: li.verifyingKey, // verifyingKey in PA-EVM is the logicRef
        isConsumed: isConsumed,
        proof: li.proof || undefined,
        resourcePayloadCount: li.appData.resourcePayload.length,
        discoveryPayloadCount: li.appData.discoveryPayload.length,
        externalPayloadCount: li.appData.externalPayload.length,
        applicationPayloadCount: li.appData.applicationPayload.length,
        action_id: actionId,
        resource_id: resource ? resourceId : undefined,
      };

      context.LogicInput.set(logicEntity);

      // Update resource with logic input link if it exists
      if (resource) {
        const updatedResource: Resource = {
          ...resource,
          logicInput_id: logicInputId,
        };
        context.Resource.set(updatedResource);
      }
    }

    // Update stats for compliance units and logic inputs from this action
    await incrementStats(context, event.block.number, event.block.timestamp, {
      actions: 1,
      complianceUnits: decodedAction.complianceVerifierInputs.length,
      logicInputs: decodedAction.logicVerifierInputs.length,
    });
  } else {
    // No decoded action data - just count the action itself
    await incrementStats(context, event.block.number, event.block.timestamp, {
      actions: 1,
    });
  }
});

// ============================================
// ResourcePayload Handler
// ============================================
// ResourcePayload fires BEFORE TransactionExecuted.
// We create/update the Resource but isConsumed will be set correctly by TransactionExecuted later.

ProtocolAdapter.ResourcePayload.handler(async ({ event, context }: ResourcePayloadArgs) => {
  const resourceId = createResourceId(event.chainId, event.params.tag);
  const txId = createTransactionId(event.chainId, event.transaction.hash);

  // Decode the blob
  const decoded = safeDecodeResourceBlob(event.params.blob);

  // Check if resource already exists
  const existingResource = await context.Resource.get(resourceId);

  if (existingResource) {
    // Update existing resource with blob data (preserve isConsumed if already set)
    const updatedResource: Resource = {
      ...existingResource,
      blobIndex: Number(event.params.index),
      rawBlob: event.params.blob,
      decodingStatus: decoded.status,
      decodingError: decoded.error || undefined,
      // logicRef comes from TransactionExecuted, not from blob decoding
      logicRef: existingResource.logicRef,
    };
    context.Resource.set(updatedResource);
  } else {
    // Create new resource - isConsumed will be updated by TransactionExecuted
    // Use index 0 as placeholder (Tag Index will be set by TransactionExecuted)
    const resourceEntity: Resource = {
      id: resourceId,
      tag: event.params.tag,
      index: 0, // Placeholder - will be set by TransactionExecuted
      blobIndex: Number(event.params.index),
      isConsumed: false, // Placeholder - will be set correctly by TransactionExecuted
      blockNumber: event.block.number,
      chainId: event.chainId,
      rawBlob: event.params.blob,
      decodingStatus: decoded.status,
      decodingError: decoded.error || undefined,
      transaction_id: txId,
      logicRef: undefined, // Will be set by TransactionExecuted
      logicInput_id: undefined,
      complianceUnit_id: undefined,
    };
    context.Resource.set(resourceEntity);
  }
});

// ============================================
// Payload Handlers (Discovery, External, Application)
// ============================================
// All three payload types are unified into a single Payload entity with a kind discriminator.

/**
 * Creates a Payload entity with the specified kind.
 * Note: blockNumber, chainId, timestamp are accessible via resource.transaction
 */
function createPayloadEntity(
  event: {
    chainId: number;
    block: { number: number; timestamp: number };
    logIndex: number;
    srcAddress: string;
    params: { tag: string; index: bigint; blob: string };
  },
  kind: "discovery" | "forwarder" | "application"
): Payload {
  const eventId = createEventId(event);
  const resourceId = createResourceId(event.chainId, event.params.tag);

  return {
    id: eventId,
    kind: kind,
    tag: event.params.tag,
    index: Number(event.params.index),
    blob: event.params.blob,
    deletionCriterion: undefined, // Would need to decode from blob structure
    resource_id: resourceId,
  };
}

// eslint-disable-next-line @typescript-eslint/require-await
ProtocolAdapter.DiscoveryPayload.handler(async ({ event, context }: DiscoveryPayloadArgs) => {
  const entity = createPayloadEntity(event, "discovery");
  context.Payload.set(entity);
});

// eslint-disable-next-line @typescript-eslint/require-await
ProtocolAdapter.ExternalPayload.handler(async ({ event, context }: ExternalPayloadArgs) => {
  const entity = createPayloadEntity(event, "forwarder");
  context.Payload.set(entity);
});

// eslint-disable-next-line @typescript-eslint/require-await
ProtocolAdapter.ApplicationPayload.handler(async ({ event, context }: ApplicationPayloadArgs) => {
  const entity = createPayloadEntity(event, "application");
  context.Payload.set(entity);
});

// ============================================
// CommitmentTreeRootAdded Handler
// ============================================

ProtocolAdapter.CommitmentTreeRootAdded.handler(
  async ({ event, context }: CommitmentTreeRootAddedArgs) => {
    const eventId = createEventId(event);

    // Use a deterministic index based on the root value for consistency
    // In practice, roots are added sequentially per transaction
    const entity: CommitmentTreeRoot = {
      id: eventId,
      root: event.params.root,
      blockNumber: event.block.number,
      txHash: event.transaction.hash,
      timestamp: event.block.timestamp,
      chainId: event.chainId,
      index: 0, // Index within transaction - would need state tracking for global index
    };

    context.CommitmentTreeRoot.set(entity);

    // Update stats
    await incrementStats(context, event.block.number, event.block.timestamp, {
      commitmentRoots: 1,
    });
  }
);

// ============================================
// ForwarderCallExecuted Handler
// ============================================

ProtocolAdapter.ForwarderCallExecuted.handler(
  // eslint-disable-next-line @typescript-eslint/require-await
  async ({ event, context }: ForwarderCallExecutedArgs) => {
    const eventId = createEventId(event);

    const entity: ForwarderCall = {
      id: eventId,
      forwarderAddress: event.params.untrustedForwarder,
      input: event.params.input,
      output: event.params.output,
      blockNumber: event.block.number,
      txHash: event.transaction.hash,
      timestamp: event.block.timestamp,
      chainId: event.chainId,
    };

    context.ForwarderCall.set(entity);
  }
);
