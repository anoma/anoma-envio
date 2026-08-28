/**
 * Creates a unique event identifier from event metadata.
 */
export function createEventId(event: {
  chainId: number;
  block: { number: number };
  logIndex: number;
  srcAddress: string;
}): string {
  return `${event.chainId}_${event.block.number}_${event.logIndex}_${event.srcAddress}`;
}

/**
 * Creates an EVM transaction identifier (correlation key shared by all events
 * in the same EVM transaction). Also the EVMTransaction entity's ID.
 */
export function createEvmTxId(chainId: number, txHash: string): string {
  return `${chainId}_${txHash}`;
}

/**
 * Creates a unique AP Transaction identifier. Includes logIndex because
 * multiple execute() calls in the same EVM tx (e.g., via multicall) each
 * emit their own TransactionExecuted event with a distinct logIndex.
 */
export function createTransactionId(chainId: number, txHash: string, logIndex: number): string {
  return `${chainId}_${txHash}_${logIndex}`;
}

/**
 * Creates a tag identifier from chain and tag hash. The chain prefix keeps one tag separate
 * across chains. Within a chain the adapter reverts on a repeated nullifier, while commitment
 * uniqueness rests on the compliance circuit rather than on any contract check.
 */
export function createTagId(chainId: number, tagHash: string): string {
  return `${chainId}_${tagHash}`;
}

/**
 * Creates a resource identifier from its action and position in the action's tag order.
 */
export function createResourceId(actionId: string, index: number): string {
  return `${actionId}_resource_${index}`;
}
