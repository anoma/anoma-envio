/**
 * Parity Check: Envio Indexer vs RPC
 *
 * Per-chain comparison of the latest TransactionExecuted event
 * indexed by Envio against what the RPC reports on-chain.
 * Compares (txHash, blockNumber, logIndex) tuples.
 *
 * All chain metadata is derived from config.yaml — nothing is hardcoded.
 *
 * Usage:
 *   ENVIO_GRAPHQL_URL=https://your-endpoint/v1/graphql pnpm test -- --grep "Parity"
 *
 * Requires ENVIO_GRAPHQL_URL to be set. Skips otherwise.
 */

import { describe, it, expect } from "vitest";
import { parseConfig, chainName, getRpcUrl, rpcCall, type NetworkConfig } from "./chain-utils.js";

// TransactionExecuted(bytes32[] tags, bytes32[] logicRefs)
const TX_EXECUTED_TOPIC = "0x10dd528db2c49add6545679b976df90d24c035d6a75b17f41b700e8c18ca5364";

const GRAPHQL_URL: string | undefined = process.env.ENVIO_GRAPHQL_URL;

interface RpcLog {
  transactionHash: string;
  blockNumber: string; // hex
  logIndex: string; // hex
}

interface IndexerTransaction {
  id: string;
  logIndex: number;
  evmTransaction: {
    txHash: string;
    blockNumber: number;
    chainId: number;
  };
}

async function getRpcChainTip(rpcUrl: string): Promise<number> {
  const hex = (await rpcCall(rpcUrl, "eth_blockNumber", [])) as string;
  return parseInt(hex, 16);
}

async function getRpcLogsForBlock(
  rpcUrl: string,
  contractAddress: string,
  blockNumber: number
): Promise<RpcLog[]> {
  const hex = `0x${blockNumber.toString(16)}`;
  return (await rpcCall(rpcUrl, "eth_getLogs", [
    {
      address: contractAddress,
      topics: [TX_EXECUTED_TOPIC],
      fromBlock: hex,
      toBlock: hex,
    },
  ])) as RpcLog[];
}

async function graphqlQuery<T>(queryString: string): Promise<T> {
  const res = await fetch(GRAPHQL_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: queryString }),
  });
  const json = (await res.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };
  if (json.errors) {
    throw new Error(json.errors.map((e) => e.message).join(", "));
  }
  return json.data as T;
}

async function getLatestIndexerTx(chainId: number): Promise<IndexerTransaction | null> {
  const data = await graphqlQuery<{
    Transaction: IndexerTransaction[];
  }>(`
    query {
      Transaction(
        limit: 1,
        where: { evmTransaction: { chainId: { _eq: ${chainId} } } },
        order_by: { evmTransaction: { blockNumber: desc } }
      ) {
        id
        logIndex
        evmTransaction { txHash blockNumber chainId }
      }
    }
  `);

  return data.Transaction.length > 0 ? data.Transaction[0] : null;
}

// Resolve networks at module load time for dynamic test generation.
// If GRAPHQL_URL is not set the describe.skipIf gate prevents execution.
const networkConfigs = (() => {
  try {
    return parseConfig();
  } catch {
    return [] as NetworkConfig[];
  }
})();

describe.skipIf(!GRAPHQL_URL)("Parity Check: Indexer vs RPC", () => {
  it("should have networks loaded from config", () => {
    expect(networkConfigs.length).toBeGreaterThan(0);
    console.log(`\n  Loaded ${networkConfigs.length} networks from config.yaml`);
  });

  for (const network of networkConfigs) {
    const name = chainName(network.id);
    const rpcUrl = getRpcUrl(network);
    const contractAddress = network.contracts[0]?.address[0];

    if (!rpcUrl) {
      it.skip(`[${name}] (chain ${network.id}) — skipped: no RPC URL`, () => {});
      continue;
    }

    if (!contractAddress) {
      it.skip(`[${name}] (chain ${network.id}) — skipped: no contract address`, () => {});
      continue;
    }

    it(`[${name}] (chain ${network.id}) — latest TX matches RPC`, async (ctx) => {
      try {
        // Get the indexer's latest tx, then verify it on-chain.
        // This approach uses only 1-2 RPC calls (works with free-tier RPCs).
        const [chainTip, indexerTx] = await Promise.all([
          getRpcChainTip(rpcUrl),
          getLatestIndexerTx(network.id),
        ]);

        if (!indexerTx) {
          console.log(`    ${name}: No transactions indexed yet`);
          return;
        }

        const idxBlock = indexerTx.evmTransaction.blockNumber;
        const idxLogIndex = indexerTx.logIndex;
        const idxTxHash = indexerTx.evmTransaction.txHash;

        console.log(
          `    ${name} Indexer : txHash=${idxTxHash.slice(0, 18)}… block=${idxBlock} logIndex=${idxLogIndex}`
        );

        // The indexer's latest tx must look valid
        expect(idxTxHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
        expect(typeof idxBlock).toBe("number");
        expect(idxBlock).toBeGreaterThan(0);
        expect(idxLogIndex).toBeGreaterThanOrEqual(0);

        // Verify the indexer's latest tx exists on-chain
        const rpcLogs = await getRpcLogsForBlock(rpcUrl, contractAddress, idxBlock);
        const matchingLog = rpcLogs.find(
          (log) => log.transactionHash.toLowerCase() === idxTxHash.toLowerCase()
        );

        expect(
          matchingLog,
          `${name}: indexer tx ${idxTxHash} not found on-chain at block ${idxBlock}`
        ).toBeDefined();
        expect(parseInt(matchingLog!.logIndex, 16)).toBe(idxLogIndex);

        const blockDiff = chainTip - idxBlock;
        if (blockDiff > 0) {
          console.log(
            `    ${name} BEHIND  : indexer is ${blockDiff} blocks behind chain tip ${chainTip}`
          );
        } else {
          console.log(`    ${name} IN SYNC`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const code = (err as { code?: number }).code;
        if (code === 429 || /rate limit|compute units|empty response/i.test(msg)) {
          console.log(`    ${name}: skipping — ${msg}`);
          ctx.skip();
          return;
        }
        throw err;
      }
    });
  }
});
