import type { ChainDailyStats, ChainStats, DailyStats, EvmOnEventContext, Stats } from "envio";

import { getUTCDay } from "../constants.js";

const STATS_ID = "global";

/** Counters shared by Stats, ChainStats, DailyStats and ChainDailyStats. */
const COUNTERS = [
  "transactions",
  "tags",
  "tagsConsumed",
  "tagsCreated",
  "actions",
  "resources",
  "commitmentRoots",
  "externalCalls",
  "forwarderCalls",
  "resourcePayloads",
  "discoveryPayloads",
  "applicationPayloads",
] as const;

type Counter = (typeof COUNTERS)[number];
type Counters = Record<Counter, bigint>;

const ZERO: Counters = {
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
};

/**
 * Per-event increments. `distinctLogics` applies to the global Stats and `chainDistinctLogics`
 * to ChainStats: a logic seen on two chains counts once globally but once per chain. The daily
 * rows do not track distinct logics.
 */
export type StatIncrements = Partial<
  Record<Counter | "distinctLogics" | "chainDistinctLogics", number>
>;

function bump<T extends Counters>(
  row: T,
  delta: Counters,
  lastUpdatedBlock: bigint,
  lastUpdatedTimestamp: bigint
): T {
  const counters = { ...ZERO };
  for (const counter of COUNTERS) {
    counters[counter] = row[counter] + delta[counter];
  }
  return { ...row, ...counters, lastUpdatedBlock, lastUpdatedTimestamp };
}

export type StatsRows = {
  dateKey: string;
  dayTimestamp: bigint;
  stats: Stats | undefined;
  daily: DailyStats | undefined;
  chainStats: ChainStats | undefined;
  chainDaily: ChainDailyStats | undefined;
};

/**
 * Reads the global, daily, per-chain and per-chain-daily rows. Handlers with other reads put
 * this in the same Promise.all so the preload pass batches everything into one round.
 */
export async function loadStats(
  context: EvmOnEventContext,
  chainId: number,
  timestamp: number
): Promise<StatsRows> {
  const { dateKey, dayTimestamp } = getUTCDay(timestamp);
  const [stats, daily, chainStats, chainDaily] = await Promise.all([
    context.Stats.get(STATS_ID),
    context.DailyStats.get(dateKey),
    context.ChainStats.get(String(chainId)),
    context.ChainDailyStats.get(`${chainId}-${dateKey}`),
  ]);
  return { dateKey, dayTimestamp, stats, daily, chainStats, chainDaily };
}

/**
 * Writes the four rows incremented by `increments`. A no-op during preload, where writes are
 * ignored anyway.
 */
export function writeStats(
  context: EvmOnEventContext,
  rows: StatsRows,
  chainId: number,
  blockNumber: number,
  timestamp: number,
  increments: StatIncrements
): void {
  if (context.isPreload) {
    return;
  }

  const { dateKey, dayTimestamp, stats, daily, chainStats, chainDaily } = rows;
  const chainKey = String(chainId);
  const chainDateKey = `${chainId}-${dateKey}`;
  const block = BigInt(blockNumber);
  const time = BigInt(timestamp);
  const chain = BigInt(chainId);
  const delta = { ...ZERO };
  for (const counter of COUNTERS) {
    delta[counter] = BigInt(increments[counter] ?? 0);
  }
  const fresh = { ...ZERO, lastUpdatedBlock: block, lastUpdatedTimestamp: time };

  const global: Stats = bump(
    stats ?? { id: STATS_ID, distinctLogics: 0n, ...fresh },
    delta,
    block,
    time
  );
  context.Stats.set({
    ...global,
    distinctLogics: global.distinctLogics + BigInt(increments.distinctLogics ?? 0),
  });

  const perChain: ChainStats = bump(
    chainStats ?? { id: chainKey, chainId: chain, distinctLogics: 0n, ...fresh },
    delta,
    block,
    time
  );
  context.ChainStats.set({
    ...perChain,
    distinctLogics: perChain.distinctLogics + BigInt(increments.chainDistinctLogics ?? 0),
  });

  const day: DailyStats = daily ?? { id: dateKey, dayTimestamp, ...fresh };
  context.DailyStats.set(bump(day, delta, block, time));

  const chainDay: ChainDailyStats = chainDaily ?? {
    id: chainDateKey,
    chainId: chain,
    date: dateKey,
    dayTimestamp,
    ...fresh,
  };
  context.ChainDailyStats.set(bump(chainDay, delta, block, time));
}

/** Reads and increments the stats rows for handlers that have no other reads. */
export async function incrementAllStats(
  context: EvmOnEventContext,
  chainId: number,
  blockNumber: number,
  timestamp: number,
  increments: StatIncrements
): Promise<void> {
  const rows = await loadStats(context, chainId, timestamp);
  writeStats(context, rows, chainId, blockNumber, timestamp, increments);
}
