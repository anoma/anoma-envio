import { indexer } from "envio";
import type {
  CommitmentTreeRoot,
  ForwarderCall,
  KindTableCommitment,
  OwnershipTransferred,
  ProtocolAdapterPaused,
  ProtocolAdapterUpgraded,
} from "envio";

import { createEventId } from "./ids.js";
import { incrementAllStats } from "./stats.js";

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
// KindTableCommitmentUpdated Handler
// ============================================
// Emitted by initialize() with the empty-table commitment and by every setKindTableCommitment
// call, so the latest row per chain is the kind table transactions must currently prove against.

indexer.onEvent(
  { contract: "ProtocolAdapter", event: "KindTableCommitmentUpdated" },
  async ({ event, context }) => {
    const eventId = createEventId(event);

    const entity: KindTableCommitment = {
      id: eventId,
      kindTableCommitment: event.params.kindTableCommitment,
      blockNumber: BigInt(event.block.number),
      logIndex: event.logIndex,
      txHash: event.transaction.hash,
      timestamp: BigInt(event.block.timestamp),
      chainId: BigInt(event.chainId),
    };

    context.KindTableCommitment.set(entity);
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

// ============================================
// Upgraded Handler
// ============================================

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
