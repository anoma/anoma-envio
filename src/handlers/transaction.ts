/**
 * Event handlers for Anoma Protocol Adapter events.
 *
 * PA-EVM Event Order (within same EVM transaction), per pa-evm ProtocolAdapter._execute:
 * 1. Per action, per resource in _processAction (all consumed, then all created):
 *    a. ForwarderCallExecuted, once per external blob of that resource
 *    b. ResourcePayload/DiscoveryPayload/ExternalPayload/ApplicationPayload for that resource
 * 2. ActionExecuted, once per action, after that action's resources
 * 3. CommitmentTreeRootAdded, once, after all actions, when the transaction created resources
 * 4. TransactionExecuted, once at the end
 *
 * CommitmentTreeRootAdded also fires outside execute(), at initialization with the empty
 * tree's root.
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
import type {
  Action as DecodedAction,
  AppData,
  Consumed,
  Created,
  Transaction as DecodedTransaction,
} from "../types/index.js";
import { BoundedCache } from "../utils/BoundedCache.js";
import { DECODED_CALLDATA_CACHE_MAX_SIZE } from "../constants.js";
import {
  createActionId,
  createEvmTxId,
  createResourceId,
  createTagId,
  createTransactionId,
} from "./ids.js";
import { loadStats, writeStats } from "./stats.js";

/**
 * One tag of an action, paired with what calldata decoding knows about its resource. Only a
 * consumed resource names the commitment tree root it was proven against.
 */
function tagOf(
  tagHash: string,
  logicRef: string,
  isConsumed: boolean,
  resource: Consumed | Created | undefined
) {
  return {
    tagHash,
    logicRef,
    isConsumed,
    appData: resource?.appData,
    commitmentTreeRoot:
      resource && "commitmentTreeRoot" in resource ? resource.commitmentTreeRoot : undefined,
  };
}

// Cache decoded calldata per EVM transaction to avoid re-decoding for each ActionExecuted event
// within it. Uses BoundedCache to prevent unbounded memory growth.
const decodedCalldataCache = new BoundedCache<string, DecodedTransaction>(
  DECODED_CALLDATA_CACHE_MAX_SIZE
);

/**
 * Get decoded transaction data from cache or decode from calldata.
 */
function getDecodedTransaction(
  context: EvmOnEventContext,
  evmTxId: string,
  input: string | undefined
): DecodedTransaction | null {
  const cached = decodedCalldataCache.get(evmTxId);
  if (cached) {
    return cached;
  }

  if (!input || !isExecuteCalldata(input)) {
    return null;
  }

  const result = decodeExecuteCalldata(input);
  if (!result.success) {
    context.log.warn(`Failed to decode calldata for ${evmTxId}: ${result.error}`);
    return null;
  }

  decodedCalldataCache.set(evmTxId, result.transaction);
  return result.transaction;
}

/**
 * Clear cache entry after transaction is fully processed.
 */
function clearDecodedCache(evmTxId: string): void {
  decodedCalldataCache.delete(evmTxId);
}

// This event fires LAST in the transaction, after every action and payload event. It carries only
// the transaction id, so its job is to create the Transaction entity and relink the actions and
// tags that earlier handlers wrote against the EVM-transaction correlation key.
indexer.onEvent(
  { contract: "ProtocolAdapter", event: "TransactionExecuted" },
  async ({ event, context }) => {
    const evmTxId = createEvmTxId(event.chainId, event.transaction.hash);
    const txId = createTransactionId(event.chainId, event.transaction.hash, event.logIndex);
    const txHash = event.transaction.hash;

    const blockNumber = BigInt(event.block.number);
    const timestamp = BigInt(event.block.timestamp);
    const chainId = BigInt(event.chainId);

    // Note: event.transaction.input is available because we added "input" to field_selection
    const decoded = getDecodedTransaction(context, evmTxId, event.transaction.input);

    // Relink the actions and tags earlier handlers wrote against the correlation key. Rows from
    // this batch come from the in-memory store and older ones from the database, so a restart
    // between an action and its transaction cannot strand them.
    const [actions, tags, statsRows] = await Promise.all([
      context.Action.getWhere({ evmTxId: { _eq: evmTxId } }),
      context.Tag.getWhere({ transaction_id: { _eq: evmTxId } }),
      loadStats(context, event.chainId, event.block.timestamp),
    ]);

    if (context.isPreload) {
      return;
    }

    // No pa-evm fields here: this is the enclosing EVM transaction, not the AP transaction.
    const evmTxEntity: EVMTransaction = {
      id: evmTxId,
      txHash: txHash,
      blockNumber: blockNumber,
      timestamp: timestamp,
      chainId: chainId,
      from: event.transaction.from,
      value: event.transaction.value,
    };

    context.EVMTransaction.set(evmTxEntity);

    const txEntity: Transaction = {
      // indexer metadata
      id: txId,
      logIndex: event.logIndex,
      contractAddress: event.srcAddress,
      blockNumber: blockNumber,
      timestamp: timestamp,
      chainId: chainId,
      evmTransaction_id: evmTxId,
      // pa-evm event params
      transactionId: event.params.transactionId,
      // pa-evm execute() calldata
      deltaProof: decoded?.deltaProof,
      aggregationProof: decoded?.aggregationProof,
    };

    context.Transaction.set(txEntity);

    for (const action of actions) {
      if (action.transaction_id === evmTxId) {
        context.Action.set({ ...action, transaction_id: txId });
      }
    }
    for (const tag of tags) {
      context.Tag.set({ ...tag, transaction_id: txId });
    }

    writeStats(context, statsRows, event.chainId, event.block.number, event.block.timestamp, {
      transactions: 1,
    });

    // The sequential pass is the last user of this transaction's decoded calldata.
    clearDecodedCache(evmTxId);
  }
);

// ActionExecuted fires BEFORE TransactionExecuted but AFTER payload events. It is authoritative
// for which tags the action consumed and created, and for their logic references. Calldata
// decoding adds what the event cannot carry: the action's unit delta, the commitment tree root each
// consumed resource was proven against, and the app data payload counts.
indexer.onEvent(
  { contract: "ProtocolAdapter", event: "ActionExecuted" },
  async ({ event, context }) => {
    const { actionTreeRoot, nullifiers, consumedLogicRefs, commitments, createdLogicRefs } =
      event.params;

    const txHash = event.transaction.hash;
    const evmTxId = createEvmTxId(event.chainId, txHash);
    const actionId = createActionId(evmTxId, actionTreeRoot);

    const blockNumber = BigInt(event.block.number);
    const timestamp = BigInt(event.block.timestamp);
    const chainId = BigInt(event.chainId);

    const decoded = getDecodedTransaction(context, evmTxId, event.transaction.input);

    // Tag ids and logic refs come from the event alone, so they load in one round together with
    // the actions of this transaction still waiting for their TransactionExecuted.
    const tagIds = [...nullifiers, ...commitments].map((tagHash) =>
      createTagId(event.chainId, tagHash)
    );
    const uniqueLogicRefs = [...new Set([...consumedLogicRefs, ...createdLogicRefs])];
    const chainLogicRefIds = uniqueLogicRefs.map((ref) => `${event.chainId}-${ref}`);
    const [pendingActions, existingTags, existingLogicRefs, existingChainLogicRefs, statsRows] =
      await Promise.all([
        context.Action.getWhere({ evmTxId: { _eq: evmTxId } }),
        Promise.all(tagIds.map((id) => context.Tag.get(id))),
        Promise.all(uniqueLogicRefs.map((ref) => context.LogicRef.get(ref))),
        Promise.all(chainLogicRefIds.map((id) => context.ChainLogicRef.get(id))),
        loadStats(context, event.chainId, event.block.timestamp),
      ]);

    // Everything below writes; the preload pass only needed the reads above.
    if (context.isPreload) {
      return;
    }

    // The contract emits ActionExecuted once per action in calldata order and events are
    // processed in that order, so this action's position is the number of actions of the same
    // transaction already written and not yet relinked.
    const actionIndex = pendingActions.filter((a) => a.transaction_id === evmTxId).length;

    // Position stays authoritative, since two actions of one transaction can share a tree root.
    // The root is the cross-check: on a drift the calldata details are dropped rather than taken
    // from another action, which would silently attach the wrong delta and payload counts.
    const positional =
      decoded && actionIndex < decoded.actions.length ? decoded.actions[actionIndex] : null;
    const decodedAction: DecodedAction | null =
      positional?.actionTreeRoot === actionTreeRoot ? positional : null;

    if (decoded && !decodedAction) {
      context.log.warn(
        `ActionExecuted #${actionIndex} for tx ${txHash} has no decoded action with root ` +
          `${actionTreeRoot} at that position (calldata decoded ` +
          `${decoded.actions.length} action(s)); resource details omitted.`
      );
    }

    // Create Action entity (transaction_id is temporary — TransactionExecuted will fix it)
    const actionEntity: Action = {
      // indexer metadata
      id: actionId,
      index: actionIndex,
      logIndex: event.logIndex,
      blockNumber: blockNumber,
      chainId: chainId,
      timestamp: timestamp,
      evmTxId: evmTxId,
      transaction_id: evmTxId,
      // pa-evm event params
      actionTreeRoot: actionTreeRoot,
      // counted from the event's nullifier and commitment arrays
      actionTagCount: nullifiers.length + commitments.length,
      consumedCount: nullifiers.length,
      createdCount: commitments.length,
      // pa-evm execute() calldata
      unitDeltaX: decodedAction ? decodedAction.unitDelta.x.toString() : undefined,
      unitDeltaY: decodedAction ? decodedAction.unitDelta.y.toString() : undefined,
    };

    context.Action.set(actionEntity);

    // ActionExecuted lists the consumed nullifiers and then the created commitments, and that
    // array order is the canonical tag order. Tag.index and Resource.index both follow it.
    let immediateExternalCount = 0;
    const orderedTags = [
      ...nullifiers.map((t, i) => tagOf(t, consumedLogicRefs[i], true, decodedAction?.consumed[i])),
      ...commitments.map((t, i) => tagOf(t, createdLogicRefs[i], false, decodedAction?.created[i])),
    ];

    for (let index = 0; index < orderedTags.length; index++) {
      const { tagHash, logicRef, isConsumed, appData, commitmentTreeRoot } = orderedTags[index];
      const tagId = tagIds[index];
      const resourceId = createResourceId(actionId, index);
      const existingTag = existingTags[index];

      // A payload event may already have created this tag with placeholder values. The side and
      // logic reference come from ActionExecuted; the index is this loop's position within it.
      context.Tag.set({
        ...(existingTag ?? {
          // indexer metadata
          id: tagId,
          blockNumber: blockNumber,
          timestamp: timestamp,
          chainId: chainId,
          transaction_id: evmTxId,
          // pa-evm event params
          tagHash: tagHash,
        }),
        // indexer metadata
        index: index,
        actionLogIndex: event.logIndex,
        resource_id: resourceId,
        // pa-evm event params; isConsumed is the array the tag came from
        isConsumed: isConsumed,
        logicRef: logicRef,
      });
      const resourceEntity: Resource = {
        // indexer metadata
        id: resourceId,
        index: index,
        timestamp: timestamp,
        chainId: chainId,
        action_id: actionId,
        tag_id: tagId,
        // pa-evm event params; isConsumed is the array the tag came from
        tagHash: tagHash,
        logicRef: logicRef,
        isConsumed: isConsumed,
        // pa-evm execute() calldata
        commitmentTreeRoot: commitmentTreeRoot,
        resourcePayloadCount: appData?.resourcePayload.length,
        discoveryPayloadCount: appData?.discoveryPayload.length,
        externalPayloadCount: appData?.externalPayload.length,
        applicationPayloadCount: appData?.applicationPayload.length,
      };

      context.Resource.set(resourceEntity);

      if (appData) {
        immediateExternalCount += writeImmediateExternalPayloads(
          context,
          resourceId,
          tagId,
          tagHash,
          appData
        );
      }
    }

    let newLogicCount = 0;
    let newChainLogicCount = 0;
    for (let i = 0; i < uniqueLogicRefs.length; i++) {
      if (!existingLogicRefs[i]) {
        context.LogicRef.set({
          // pa-evm event params
          id: uniqueLogicRefs[i],
          // indexer metadata
          firstSeenBlock: blockNumber,
          firstSeenTimestamp: timestamp,
          firstSeenChainId: chainId,
          firstSeenTxHash: txHash,
        });
        newLogicCount++;
      }
      if (!existingChainLogicRefs[i]) {
        context.ChainLogicRef.set({
          // indexer metadata
          id: chainLogicRefIds[i],
          chainId: chainId,
          firstSeenBlock: blockNumber,
          firstSeenTimestamp: timestamp,
          firstSeenTxHash: txHash,
          // pa-evm event params
          logicRef: uniqueLogicRefs[i],
        });
        newChainLogicCount++;
      }
    }

    writeStats(context, statsRows, event.chainId, event.block.number, event.block.timestamp, {
      actions: 1,
      resources: orderedTags.length,
      tags: orderedTags.length,
      tagsConsumed: nullifiers.length,
      tagsCreated: commitments.length,
      externalCalls: immediateExternalCount,
      distinctLogics: newLogicCount,
      chainDistinctLogics: newChainLogicCount,
    });
  }
);

/**
 * Writes Payload entities for the external payloads that never produce an event, and returns
 * how many were written so the caller can count them into the externalCalls stat, which the
 * ExternalPayload handler raises for the emitted ones.
 *
 * Every external blob drives a forwarder call whatever its deletion criterion, but
 * _emitAppDataBlobs emits a payload event only for the ones marked `Never`. Taking the
 * `Immediately` ones from calldata keeps the external-call record complete without duplicating
 * what ExternalPayload already covers.
 */
function writeImmediateExternalPayloads(
  context: EvmOnEventContext,
  resourceId: string,
  tagId: string,
  tagHash: string,
  appData: AppData
): number {
  let written = 0;
  for (let index = 0; index < appData.externalPayload.length; index++) {
    const blob = appData.externalPayload[index];
    if (blob.deletionCriterion !== DeletionCriterion.Immediately) {
      continue;
    }

    context.Payload.set({
      // indexer metadata
      id: `${resourceId}_externalCall_${index}`,
      category: "externalCall",
      tag_id: tagId,
      // pa-evm execute() calldata (these blobs never get their own event)
      tagHash: tagHash,
      index: index,
      blob: blob.blob,
      deletionCriterion: "immediately",
    });
    written++;
  }
  return written;
}
