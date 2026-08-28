import { indexer } from "envio";
import type { CommitmentTreeRoot, KindTableCommitment } from "envio";

import { createEventId } from "./ids.js";
import { incrementAllStats } from "./stats.js";

indexer.onEvent(
  { contract: "ProtocolAdapter", event: "CommitmentTreeRootAdded" },
  async ({ event, context }) => {
    const { chainId } = event;
    const { number: blockNumber, timestamp } = event.block;

    const entity: CommitmentTreeRoot = {
      // indexer metadata
      id: createEventId(event),
      blockNumber: BigInt(blockNumber),
      logIndex: event.logIndex,
      txHash: event.transaction.hash,
      timestamp: BigInt(timestamp),
      chainId: BigInt(chainId),
      // pa-evm event params
      root: event.params.root,
    };

    context.CommitmentTreeRoot.set(entity);

    await incrementAllStats(context, chainId, blockNumber, timestamp, {
      commitmentRoots: 1,
    });
  }
);

// Emitted by initialize() with the empty-table commitment and by every setKindTableCommitment
// call, so the latest row per chain is the kind table transactions must currently prove against.
indexer.onEvent(
  { contract: "ProtocolAdapter", event: "KindTableCommitmentUpdated" },
  async ({ event, context }) => {
    const eventId = createEventId(event);

    const entity: KindTableCommitment = {
      // indexer metadata
      id: eventId,
      blockNumber: BigInt(event.block.number),
      logIndex: event.logIndex,
      txHash: event.transaction.hash,
      timestamp: BigInt(event.block.timestamp),
      chainId: BigInt(event.chainId),
      // pa-evm event params
      kindTableCommitment: event.params.kindTableCommitment,
    };

    context.KindTableCommitment.set(entity);
  }
);
