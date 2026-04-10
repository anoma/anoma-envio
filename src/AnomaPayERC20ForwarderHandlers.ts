/**
 * Event handlers for AnomaPayERC20Forwarder Wrapped and Unwrapped events.
 *
 * The AnomaPayERC20Forwarder contract allows users to wrap ERC20 tokens (deposit)
 * and unwrap them (withdraw) across supported chains.
 */

import {
  AnomaPayERC20Forwarder,
  ERC20Wrap,
  ERC20Unwrap,
  AnomaPayERC20ForwarderStats,
  handlerContext,
  AnomaPayERC20Forwarder_Wrapped_event,
  AnomaPayERC20Forwarder_Unwrapped_event,
} from "generated";

// ============================================
// Type Aliases
// ============================================

type WrappedArgs = {
  event: AnomaPayERC20Forwarder_Wrapped_event;
  context: handlerContext;
};

type UnwrappedArgs = {
  event: AnomaPayERC20Forwarder_Unwrapped_event;
  context: handlerContext;
};

// ============================================
// Stats Singleton
// ============================================
const STATS_ID = "global";

/**
 * Gets the current AnomaPayERC20ForwarderStats or creates a new one with zero counts.
 */
async function getOrCreateStats(context: handlerContext): Promise<AnomaPayERC20ForwarderStats> {
  const existing = await context.AnomaPayERC20ForwarderStats.get(STATS_ID);
  if (existing) {
    return existing;
  }
  return {
    id: STATS_ID,
    totalWraps: 0,
    totalUnwraps: 0,
    totalWrappedVolume: BigInt(0),
    totalUnwrappedVolume: BigInt(0),
    lastUpdatedBlock: 0,
    lastUpdatedTimestamp: 0,
  };
}

// ============================================
// Wrapped Handler
// ============================================

AnomaPayERC20Forwarder.Wrapped.handler(async ({ event, context }: WrappedArgs) => {
  const id = `${event.chainId}_${event.transaction.hash}_${event.logIndex}`;

  const entity: ERC20Wrap = {
    id,
    token: event.params.token,
    from: event.params.from,
    amount: event.params.amount,
    blockNumber: event.block.number,
    txHash: event.transaction.hash,
    logIndex: event.logIndex,
    timestamp: event.block.timestamp,
    chainId: event.chainId,
  };

  context.ERC20Wrap.set(entity);

  const stats = await getOrCreateStats(context);
  context.AnomaPayERC20ForwarderStats.set({
    ...stats,
    totalWraps: stats.totalWraps + 1,
    totalWrappedVolume: stats.totalWrappedVolume + event.params.amount,
    lastUpdatedBlock: event.block.number,
    lastUpdatedTimestamp: event.block.timestamp,
  });
});

// ============================================
// Unwrapped Handler
// ============================================

AnomaPayERC20Forwarder.Unwrapped.handler(async ({ event, context }: UnwrappedArgs) => {
  const id = `${event.chainId}_${event.transaction.hash}_${event.logIndex}`;

  const entity: ERC20Unwrap = {
    id,
    token: event.params.token,
    to: event.params.to,
    amount: event.params.amount,
    blockNumber: event.block.number,
    txHash: event.transaction.hash,
    logIndex: event.logIndex,
    timestamp: event.block.timestamp,
    chainId: event.chainId,
  };

  context.ERC20Unwrap.set(entity);

  const stats = await getOrCreateStats(context);
  context.AnomaPayERC20ForwarderStats.set({
    ...stats,
    totalUnwraps: stats.totalUnwraps + 1,
    totalUnwrappedVolume: stats.totalUnwrappedVolume + event.params.amount,
    lastUpdatedBlock: event.block.number,
    lastUpdatedTimestamp: event.block.timestamp,
  });
});
