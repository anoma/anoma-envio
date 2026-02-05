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
 * Resource index parity convention from TransactionExecuted events:
 * - Even indices (0, 2, 4...): consumed resources (nullifiers)
 * - Odd indices (1, 3, 5...): created resources (commitments)
 */
export function isConsumedIndex(index: number): boolean {
  return index % 2 === 0;
}

/**
 * ID format suffixes used in entity identifiers.
 */
export const ID_SUFFIXES = {
  RESOURCE: "_resource",
  COMPLIANCE: "_compliance_",
  LOGIC: "_logic_",
} as const;
