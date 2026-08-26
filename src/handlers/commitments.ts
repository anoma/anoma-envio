import { indexer } from "envio";
import type { CommitmentTreeRoot, KindTableCommitment } from "envio";

import { createEventId } from "./ids.js";
import { incrementAllStats } from "./stats.js";

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

    await incrementAllStats(context, event.chainId, event.block.number, event.block.timestamp, {
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
