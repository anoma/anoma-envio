import type { EvmOnEventContext, Stats, ChainStats } from "envio";

import { getUTCDay } from "../constants.js";

// ============================================
// Stats Singleton
// ============================================
const STATS_ID = "global";

/**
 * Gets the current stats or creates a new one with zero counts.
 */
async function getOrCreateStats(context: EvmOnEventContext): Promise<Stats> {
  const existing = await context.Stats.get(STATS_ID);
  if (existing) {
    return existing;
  }
  return {
    id: STATS_ID,
    transactions: 0n,
    tags: 0n,
    tagsConsumed: 0n,
    tagsCreated: 0n,
    actions: 0n,
    resources: 0n,
    commitmentRoots: 0n,
    distinctLogics: 0n,
    externalCalls: 0n,
    forwarderCalls: 0n,
    resourcePayloads: 0n,
    discoveryPayloads: 0n,
    applicationPayloads: 0n,
    lastUpdatedBlock: 0n,
    lastUpdatedTimestamp: 0n,
  };
}

async function getOrCreateChainStats(
  context: EvmOnEventContext,
  chainId: number
): Promise<ChainStats> {
  const id = String(chainId);
  const existing = await context.ChainStats.get(id);
  if (existing) {
    return existing;
  }
  return {
    id,
    chainId: BigInt(chainId),
    transactions: 0n,
    tags: 0n,
    tagsConsumed: 0n,
    tagsCreated: 0n,
    actions: 0n,
    resources: 0n,
    commitmentRoots: 0n,
    distinctLogics: 0n,
    externalCalls: 0n,
    forwarderCalls: 0n,
    resourcePayloads: 0n,
    discoveryPayloads: 0n,
    applicationPayloads: 0n,
    lastUpdatedBlock: 0n,
    lastUpdatedTimestamp: 0n,
  };
}

/**
 * Unified helper: increments global Stats + DailyStats + per-chain
 * ChainStats + ChainDailyStats. All handler call sites use this.
 *
 * `distinctLogics` applies to the global Stats; `chainDistinctLogics`
 * applies to ChainStats (these can differ — a logic seen on two chains
 * counts once globally but once per chain). DailyStats and
 * ChainDailyStats do not track distinctLogics.
 */
export async function incrementAllStats(
  context: EvmOnEventContext,
  chainId: number,
  blockNumber: number,
  timestamp: number,
  increments: {
    transactions?: number;
    tags?: number;
    tagsConsumed?: number;
    tagsCreated?: number;
    actions?: number;
    resources?: number;
    commitmentRoots?: number;
    distinctLogics?: number;
    chainDistinctLogics?: number;
    externalCalls?: number;
    forwarderCalls?: number;
    resourcePayloads?: number;
    discoveryPayloads?: number;
    applicationPayloads?: number;
  }
): Promise<void> {
  const { dateKey, dayTimestamp } = getUTCDay(timestamp);
  const chainDateKey = `${chainId}-${dateKey}`;

  const [stats, daily, chainStats, chainDaily] = await Promise.all([
    getOrCreateStats(context),
    context.DailyStats.get(dateKey).then(
      (existing) =>
        existing || {
          id: dateKey,
          dayTimestamp,
          transactions: 0n,
          tags: 0n,
          tagsConsumed: 0n,
          tagsCreated: 0n,
          actions: 0n,
          resources: 0n,
          commitmentRoots: 0n,
          externalCalls: 0n,
          forwarderCalls: 0n,
          resourcePayloads: 0n,
          discoveryPayloads: 0n,
          applicationPayloads: 0n,
          lastUpdatedBlock: 0n,
          lastUpdatedTimestamp: 0n,
        }
    ),
    getOrCreateChainStats(context, chainId),
    context.ChainDailyStats.get(chainDateKey).then(
      (existing) =>
        existing || {
          id: chainDateKey,
          chainId: BigInt(chainId),
          date: dateKey,
          dayTimestamp,
          transactions: 0n,
          tags: 0n,
          tagsConsumed: 0n,
          tagsCreated: 0n,
          actions: 0n,
          resources: 0n,
          commitmentRoots: 0n,
          externalCalls: 0n,
          forwarderCalls: 0n,
          resourcePayloads: 0n,
          discoveryPayloads: 0n,
          applicationPayloads: 0n,
          lastUpdatedBlock: 0n,
          lastUpdatedTimestamp: 0n,
        }
    ),
  ]);

  context.Stats.set({
    ...stats,
    transactions: stats.transactions + BigInt(increments.transactions ?? 0),
    tags: stats.tags + BigInt(increments.tags ?? 0),
    tagsConsumed: stats.tagsConsumed + BigInt(increments.tagsConsumed ?? 0),
    tagsCreated: stats.tagsCreated + BigInt(increments.tagsCreated ?? 0),
    actions: stats.actions + BigInt(increments.actions ?? 0),
    resources: stats.resources + BigInt(increments.resources ?? 0),
    commitmentRoots: stats.commitmentRoots + BigInt(increments.commitmentRoots ?? 0),
    distinctLogics: stats.distinctLogics + BigInt(increments.distinctLogics ?? 0),
    externalCalls: stats.externalCalls + BigInt(increments.externalCalls ?? 0),
    forwarderCalls: stats.forwarderCalls + BigInt(increments.forwarderCalls ?? 0),
    resourcePayloads: stats.resourcePayloads + BigInt(increments.resourcePayloads ?? 0),
    discoveryPayloads: stats.discoveryPayloads + BigInt(increments.discoveryPayloads ?? 0),
    applicationPayloads: stats.applicationPayloads + BigInt(increments.applicationPayloads ?? 0),
    lastUpdatedBlock: BigInt(blockNumber),
    lastUpdatedTimestamp: BigInt(timestamp),
  });

  context.DailyStats.set({
    ...daily,
    transactions: daily.transactions + BigInt(increments.transactions ?? 0),
    tags: daily.tags + BigInt(increments.tags ?? 0),
    tagsConsumed: daily.tagsConsumed + BigInt(increments.tagsConsumed ?? 0),
    tagsCreated: daily.tagsCreated + BigInt(increments.tagsCreated ?? 0),
    actions: daily.actions + BigInt(increments.actions ?? 0),
    resources: daily.resources + BigInt(increments.resources ?? 0),
    commitmentRoots: daily.commitmentRoots + BigInt(increments.commitmentRoots ?? 0),
    externalCalls: daily.externalCalls + BigInt(increments.externalCalls ?? 0),
    forwarderCalls: daily.forwarderCalls + BigInt(increments.forwarderCalls ?? 0),
    resourcePayloads: daily.resourcePayloads + BigInt(increments.resourcePayloads ?? 0),
    discoveryPayloads: daily.discoveryPayloads + BigInt(increments.discoveryPayloads ?? 0),
    applicationPayloads: daily.applicationPayloads + BigInt(increments.applicationPayloads ?? 0),
    lastUpdatedBlock: BigInt(blockNumber),
    lastUpdatedTimestamp: BigInt(timestamp),
  });

  context.ChainStats.set({
    ...chainStats,
    transactions: chainStats.transactions + BigInt(increments.transactions ?? 0),
    tags: chainStats.tags + BigInt(increments.tags ?? 0),
    tagsConsumed: chainStats.tagsConsumed + BigInt(increments.tagsConsumed ?? 0),
    tagsCreated: chainStats.tagsCreated + BigInt(increments.tagsCreated ?? 0),
    actions: chainStats.actions + BigInt(increments.actions ?? 0),
    resources: chainStats.resources + BigInt(increments.resources ?? 0),
    commitmentRoots: chainStats.commitmentRoots + BigInt(increments.commitmentRoots ?? 0),
    distinctLogics: chainStats.distinctLogics + BigInt(increments.chainDistinctLogics ?? 0),
    externalCalls: chainStats.externalCalls + BigInt(increments.externalCalls ?? 0),
    forwarderCalls: chainStats.forwarderCalls + BigInt(increments.forwarderCalls ?? 0),
    resourcePayloads: chainStats.resourcePayloads + BigInt(increments.resourcePayloads ?? 0),
    discoveryPayloads: chainStats.discoveryPayloads + BigInt(increments.discoveryPayloads ?? 0),
    applicationPayloads:
      chainStats.applicationPayloads + BigInt(increments.applicationPayloads ?? 0),
    lastUpdatedBlock: BigInt(blockNumber),
    lastUpdatedTimestamp: BigInt(timestamp),
  });

  context.ChainDailyStats.set({
    ...chainDaily,
    transactions: chainDaily.transactions + BigInt(increments.transactions ?? 0),
    tags: chainDaily.tags + BigInt(increments.tags ?? 0),
    tagsConsumed: chainDaily.tagsConsumed + BigInt(increments.tagsConsumed ?? 0),
    tagsCreated: chainDaily.tagsCreated + BigInt(increments.tagsCreated ?? 0),
    actions: chainDaily.actions + BigInt(increments.actions ?? 0),
    resources: chainDaily.resources + BigInt(increments.resources ?? 0),
    commitmentRoots: chainDaily.commitmentRoots + BigInt(increments.commitmentRoots ?? 0),
    externalCalls: chainDaily.externalCalls + BigInt(increments.externalCalls ?? 0),
    forwarderCalls: chainDaily.forwarderCalls + BigInt(increments.forwarderCalls ?? 0),
    resourcePayloads: chainDaily.resourcePayloads + BigInt(increments.resourcePayloads ?? 0),
    discoveryPayloads: chainDaily.discoveryPayloads + BigInt(increments.discoveryPayloads ?? 0),
    applicationPayloads:
      chainDaily.applicationPayloads + BigInt(increments.applicationPayloads ?? 0),
    lastUpdatedBlock: BigInt(blockNumber),
    lastUpdatedTimestamp: BigInt(timestamp),
  });
}
