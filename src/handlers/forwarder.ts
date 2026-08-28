import { indexer } from "envio";
import type { ForwarderCall } from "envio";

import { createEventId } from "./ids.js";
import { incrementAllStats } from "./stats.js";

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
