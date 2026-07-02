/**
 * Constants for the Anoma Protocol Adapter indexer.
 *
 * Centralized location for hardcoded values, magic numbers, and configuration.
 */

/**
 * Function selector for the execute() function on the Protocol Adapter contract.
 * First 4 bytes of keccak256("execute(((bytes32,bytes32,bytes32,bytes32,uint256,bytes32,bytes32,bytes32,bytes32,bytes32,bytes),(bytes32,bytes32,bytes32,bytes),bytes)[],(bytes,(bytes32,bytes32,bytes32,bytes32,bytes),(bytes,bytes,bytes))[],bytes,bytes)")
 */
export const EXECUTE_SELECTOR = "0xed3cf91f";

/**
 * Maximum number of decoded transaction calldata entries to cache.
 * Prevents unbounded memory growth when processing many transactions.
 */
export const DECODED_CALLDATA_CACHE_MAX_SIZE = 1000;

/**
 * Tag index parity convention from TransactionExecuted events:
 * - Even indices (0, 2, 4...): consumed tags (nullifiers)
 * - Odd indices (1, 3, 5...): created tags (commitments)
 */
export function isConsumedIndex(index: number): boolean {
  return index % 2 === 0;
}

/**
 * ID format suffixes used in entity identifiers.
 */
export const ID_SUFFIXES = {
  TAG: "",
  COMPLIANCE: "_compliance_",
  LOGIC: "_logic_",
} as const;

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
