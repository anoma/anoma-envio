import { indexer } from "envio";
import type { Payload, Tag } from "envio";

import { createEventId, createEvmTxId, createTagId } from "./ids.js";
import { incrementAllStats } from "./stats.js";

// ResourcePayload fires BEFORE ActionExecuted.
indexer.onEvent(
  { contract: "ProtocolAdapter", event: "ResourcePayload" },
  async ({ event, context }) => {
    const tagHash = event.params.tag;
    const tagId = createTagId(event.chainId, tagHash);
    const evmTxId = createEvmTxId(event.chainId, event.transaction.hash);

    const payloadEntity = createPayloadEntity(event, "resource");
    context.Payload.set(payloadEntity);

    // The stats reads and the tag lookup are independent, so they share one read round.
    const [, existingTag] = await Promise.all([
      incrementAllStats(context, event.chainId, event.block.number, event.block.timestamp, {
        resourcePayloads: 1,
      }),
      context.Tag.get(tagId),
    ]);

    // Create the Tag entity if ActionExecuted has not yet supplied the authoritative values.
    if (!existingTag) {
      const tagEntity: Tag = {
        // indexer metadata
        id: tagId,
        // Placeholder — ActionExecuted sets the canonical position. Not the event's `index`
        // param, which is a blob position and belongs to Payload.
        index: 0,
        actionLogIndex: undefined, // Set by ActionExecuted, which knows the action
        isConsumed: false, // Placeholder — ActionExecuted sets the side
        blockNumber: BigInt(event.block.number),
        timestamp: BigInt(event.block.timestamp),
        chainId: BigInt(event.chainId),
        transaction_id: evmTxId, // Temporary — TransactionExecuted will set the proper txId
        logicRef: undefined, // Will be set by ActionExecuted
        resource_id: undefined,
        // pa-evm event params
        tagHash: tagHash,
      };
      context.Tag.set(tagEntity);
    }
  }
);

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
  const tagHash = event.params.tag;
  const tagId = createTagId(event.chainId, tagHash);

  return {
    // indexer metadata
    id: eventId,
    category: category,
    // The protocol adapter only emits payload events for blobs marked `Never`.
    deletionCriterion: "never",
    tag_id: tagId,
    // pa-evm event params
    tagHash: tagHash,
    index: Number(event.params.index),
    blob: event.params.blob,
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
