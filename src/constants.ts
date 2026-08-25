/**
 * Constants for the Anoma Protocol Adapter indexer.
 *
 * Centralized location for hardcoded values, magic numbers, and configuration.
 *
 * The `execute` selector is deliberately not here: it is derived from the decoder's ABI in
 * `decoders/ActionDecoder.ts`, so it cannot drift from the shape actually being decoded.
 */

/**
 * Maximum number of decoded transaction calldata entries to cache.
 * Prevents unbounded memory growth when processing many transactions.
 */
export const DECODED_CALLDATA_CACHE_MAX_SIZE = 1000;

/**
 * Number of seconds in a UTC day.
 */
export const SECONDS_PER_DAY = 86400;

/**
 * Converts a Unix timestamp (seconds) to a UTC day key and start-of-day timestamp.
 * Used by DailyStats to bucket counters by calendar day.
 *
 * Input stays `number` because call sites pass `event.block.timestamp` (number in envio V3).
 * Returns `dayTimestamp` as `bigint` to match the DailyStats/ChainDailyStats BigInt field.
 */
export function getUTCDay(timestampSeconds: number): {
  dateKey: string;
  dayTimestamp: bigint;
} {
  const dayTimestampNum = Math.floor(timestampSeconds / SECONDS_PER_DAY) * SECONDS_PER_DAY;
  const date = new Date(dayTimestampNum * 1000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return { dateKey: `${year}-${month}-${day}`, dayTimestamp: BigInt(dayTimestampNum) };
}
