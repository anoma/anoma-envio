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
import type { EvmOnEventContext, EVMTransaction, Transaction, Action, Resource } from "envio";

import { decodeExecuteCalldata, isExecuteCalldata } from "../decoders/ActionDecoder.js";
import { DeletionCriterion } from "../types/index.js";
import type { Action as DecodedAction, AppData } from "../types/index.js";
import { BoundedCache } from "../utils/BoundedCache.js";
import { DECODED_CALLDATA_CACHE_MAX_SIZE } from "../constants.js";
import { createEvmTxId, createResourceId, createTagId, createTransactionId } from "./ids.js";
import { incrementAllStats } from "./stats.js";

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

    // Relink the actions and tags earlier handlers wrote against the correlation key. Rows from
    // this batch come from the in-memory store and older ones from the database, so a restart
    // between an action and its transaction cannot strand them.
    const [actions, tags] = await Promise.all([
      context.Action.getWhere({ evmTxId: { _eq: evmTxId } }),
      context.Tag.getWhere({ transaction_id: { _eq: evmTxId } }),
    ]);

    for (const action of actions) {
      if (action.transaction_id === evmTxId) {
        context.Action.set({ ...action, transaction_id: txId });
      }
    }
    for (const tag of tags) {
      context.Tag.set({ ...tag, transaction_id: txId });
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

    // Tag ids and logic refs come from the event alone, so they load in one round together with
    // the actions of this transaction still waiting for their TransactionExecuted.
    const tagIds = [...nullifiers, ...commitments].map((tagHash) =>
      createTagId(event.chainId, tagHash)
    );
    const uniqueLogicRefs = [...new Set([...consumedLogicRefs, ...createdLogicRefs])];
    const chainLogicRefIds = uniqueLogicRefs.map((ref) => `${event.chainId}-${ref}`);
    const [pendingActions, existingTags, existingLogicRefs, existingChainLogicRefs] =
      await Promise.all([
        context.Action.getWhere({ evmTxId: { _eq: evmTxId } }),
        Promise.all(tagIds.map((id) => context.Tag.get(id))),
        Promise.all(uniqueLogicRefs.map((ref) => context.LogicRef.get(ref))),
        Promise.all(chainLogicRefIds.map((id) => context.ChainLogicRef.get(id))),
      ]);

    // The contract emits ActionExecuted once per action in calldata order and events are
    // processed in that order, so this action's position is the number of actions of the same
    // transaction already written and not yet relinked.
    const actionIndex = pendingActions.filter((a) => a.transaction_id === evmTxId).length;

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
