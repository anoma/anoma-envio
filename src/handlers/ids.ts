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
 * Creates an Action identifier from its EVM transaction and action tree root. Multiple actions
 * can share one EVM transaction, so the root separates them. Two actions of one transaction can
 * only collide here if both consume nothing; otherwise the repeated nullifier reverts the
 * transaction on-chain.
 */
export function createActionId(evmTxId: string, actionTreeRoot: string): string {
  return `${evmTxId}_${actionTreeRoot}`;
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

/**
 * Creates the identifier of an external payload taken from calldata. Every other Payload comes
 * from its own event and is keyed by `createEventId`; these blobs are emitted by no event, so
 * they key off the resource that carries them and their position in its external payload array.
 */
export function createExternalPayloadId(resourceId: string, index: number): string {
  return `${resourceId}_externalCall_${index}`;
}

/**
 * Creates a per-chain logic reference identifier. The same logic can appear on several chains;
 * LogicRef counts it once globally, ChainLogicRef once per chain.
 */
export function createChainLogicRefId(chainId: number, logicRef: string): string {
  return `${chainId}-${logicRef}`;
}

/** Creates the ChainStats identifier for one chain. */
export function createChainStatsId(chainId: number): string {
  return String(chainId);
}

/** Creates the ChainDailyStats identifier from a chain and a UTC day key. */
export function createChainDailyStatsId(chainId: number, dateKey: string): string {
  return `${chainId}-${dateKey}`;
}
