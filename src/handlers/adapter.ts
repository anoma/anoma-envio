import { indexer } from "envio";
import type { OwnershipTransferred, ProtocolAdapterPaused, ProtocolAdapterUpgraded } from "envio";

import { createEventId } from "./ids.js";

indexer.onEvent(
  { contract: "ProtocolAdapter", event: "OwnershipTransferred" },
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

// The v2 adapters sit behind ERC-1967 proxies, so the implementation can change under a fixed
// address. Recorded on its own, independent of the pause state and of transaction processing.
indexer.onEvent({ contract: "ProtocolAdapter", event: "Upgraded" }, async ({ event, context }) => {
  const entity: ProtocolAdapterUpgraded = {
    id: createEventId(event),
    implementation: event.params.implementation,
    blockNumber: BigInt(event.block.number),
    txHash: event.transaction.hash,
    timestamp: BigInt(event.block.timestamp),
    chainId: BigInt(event.chainId),
  };

  context.ProtocolAdapterUpgraded.set(entity);
});
