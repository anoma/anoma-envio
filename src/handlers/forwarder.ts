import { indexer } from "envio";
import type { ForwarderCall } from "envio";

import { createEventId } from "./ids.js";
import { incrementAllStats } from "./stats.js";

indexer.onEvent(
  { contract: "ProtocolAdapter", event: "ForwarderCallExecuted" },
  async ({ event, context }) => {
    const { chainId } = event;
    const { number: blockNumber, timestamp } = event.block;

    const entity: ForwarderCall = {
      // indexer metadata
      id: createEventId(event),
      blockNumber: BigInt(blockNumber),
      txHash: event.transaction.hash,
      timestamp: BigInt(timestamp),
      chainId: BigInt(chainId),
      // pa-evm event params
      untrustedForwarder: event.params.untrustedForwarder,
      input: event.params.input,
      output: event.params.output,
    };

    context.ForwarderCall.set(entity);

    await incrementAllStats(context, chainId, blockNumber, timestamp, {
      forwarderCalls: 1,
    });
  }
);
