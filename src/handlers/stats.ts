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

/**
 * Increments the global, daily, per-chain and per-chain-daily statistics in one batched read
 * round. Every handler that counts something goes through here.
 */
export async function incrementAllStats(
  context: EvmOnEventContext,
  chainId: number,
  blockNumber: number,
  timestamp: number,
  increments: StatIncrements
): Promise<void> {
  const { dateKey, dayTimestamp } = getUTCDay(timestamp);
  const chainKey = String(chainId);
  const chainDateKey = `${chainId}-${dateKey}`;

  const [stats, daily, chainStats, chainDaily] = await Promise.all([
    context.Stats.get(STATS_ID),
    context.DailyStats.get(dateKey),
    context.ChainStats.get(chainKey),
    context.ChainDailyStats.get(chainDateKey),
  ]);

  // Writes are ignored during preload; the reads above already warmed the rows.
  if (context.isPreload) {
    return;
  }

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
