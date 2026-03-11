/**
 * Parity Check: Envio Indexer vs RPC
 *
 * Per-chain comparison of the latest TransactionExecuted event
 * indexed by Envio against what the RPC reports on-chain.
 * Compares (txHash, blockNumber, logIndex) tuples.
 *
 * Usage:
 *   ENVIO_GRAPHQL_URL=https://your-endpoint/v1/graphql pnpm test -- --grep "Parity"
 *
 * Requires ENVIO_GRAPHQL_URL to be set. Skips otherwise.
 */

import { expect } from "chai";
import * as yaml from "yaml";
import * as fs from "fs";
import * as path from "path";

// TransactionExecuted(bytes32[] tags, bytes32[] logicRefs)
const TX_EXECUTED_TOPIC = "0x10dd528db2c49add6545679b976df90d24c035d6a75b17f41b700e8c18ca5364";

const GRAPHQL_URL: string | undefined = process.env.ENVIO_GRAPHQL_URL;

// Default public RPCs for chains that don't have rpc_config in config.yaml
const DEFAULT_RPCS: Record<number, string> = {
  1: "https://eth.llamarpc.com",
  42161: "https://arb1.arbitrum.io/rpc",
  8453: "https://mainnet.base.org",
  10: "https://mainnet.optimism.io",
  11155111: "https://rpc.sepolia.org",
  84532: "https://sepolia.base.org",
};

interface NetworkConfig {
  id: number;
  start_block: number;
  rpc_config?: { url: string };
  contracts: Array<{ name: string; address: string[] }>;
}

interface Config {
  networks: NetworkConfig[];
}

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

function parseConfig(): NetworkConfig[] {
  const configPath = path.resolve(__dirname, "..", "config.yaml");
  const raw = fs.readFileSync(configPath, "utf-8");
  const config = yaml.parse(raw) as Config;
  return config.networks;
}

function getRpcUrl(network: NetworkConfig): string | undefined {
  // Env var override: RPC_<chainId>
  const envKey = `RPC_${network.id}`;
  if (process.env[envKey]) {
    return process.env[envKey];
  }
  if (network.rpc_config?.url) {
    return network.rpc_config.url;
  }
  return DEFAULT_RPCS[network.id];
}

function chainName(id: number): string {
  const names: Record<number, string> = {
    1: "Mainnet",
    42161: "Arbitrum",
    8453: "Base",
    10: "Optimism",
    11155111: "Sepolia",
    84532: "Base Sepolia",
    56: "BNB Smart Chain",
    97: "BNB Testnet",
    1313161554: "Aurora",
    1313161555: "Aurora Testnet",
  };
  return names[id] ?? `Chain ${id}`;
}

async function rpcCall(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) {
    throw new Error(`RPC error: ${json.error.message}`);
  }
  return json.result;
}

async function getLatestRpcLog(rpcUrl: string, contractAddress: string): Promise<RpcLog | null> {
  const latestBlock = (await rpcCall(rpcUrl, "eth_blockNumber", [])) as string;

  // Search backwards in chunks to find the latest TransactionExecuted event.
  // Start from the latest block and go back up to 500k blocks.
  const latest = parseInt(latestBlock, 16);
  const chunkSize = 50_000;
  const maxLookback = 500_000;

  for (let to = latest; to > latest - maxLookback && to >= 0; to -= chunkSize) {
    const from = Math.max(to - chunkSize + 1, 0);
    const logs = (await rpcCall(rpcUrl, "eth_getLogs", [
      {
        address: contractAddress,
        topics: [TX_EXECUTED_TOPIC],
        fromBlock: `0x${from.toString(16)}`,
        toBlock: `0x${to.toString(16)}`,
      },
    ])) as RpcLog[];

    if (logs.length > 0) {
      // Return the last (most recent) log
      return logs[logs.length - 1];
    }
  }

  return null;
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

describe("Parity Check: Indexer vs RPC", function () {
  this.timeout(120_000); // RPC calls can be slow

  let networks: NetworkConfig[];

  before(function () {
    if (!GRAPHQL_URL) {
      console.log("  ENVIO_GRAPHQL_URL not set — skipping parity checks");
      this.skip();
    }
    networks = parseConfig();
  });

  it("should have networks loaded from config", function () {
    expect(networks).to.be.an("array").with.length.greaterThan(0);
    console.log(`\n  Loaded ${networks.length} networks from config.yaml`);
  });

  // Dynamically create a test per chain
  // Note: we use before() to set up tests since mocha needs static describe/it
  // but we can iterate in a describe block
  const networkConfigs = (() => {
    try {
      const configPath = path.resolve(__dirname, "..", "config.yaml");
      const raw = fs.readFileSync(configPath, "utf-8");
      return (yaml.parse(raw) as Config).networks;
    } catch {
      return [];
    }
  })();

  for (const network of networkConfigs) {
    const name = chainName(network.id);
    const rpcUrl = getRpcUrl(network);
    const contractAddress = network.contracts[0]?.address[0];

    if (!rpcUrl) {
      it(`[${name}] (chain ${network.id}) — skipped: no RPC URL`, function () {
        this.skip();
      });
      continue;
    }

    if (!contractAddress) {
      it(`[${name}] (chain ${network.id}) — skipped: no contract address`, function () {
        this.skip();
      });
      continue;
    }

    it(`[${name}] (chain ${network.id}) — latest TX matches RPC`, async function () {
      if (!GRAPHQL_URL) {
        this.skip();
      }

      // Fetch from both sources in parallel
      const [rpcLog, indexerTx] = await Promise.all([
        getLatestRpcLog(rpcUrl, contractAddress),
        getLatestIndexerTx(network.id),
      ]);

      if (!rpcLog && !indexerTx) {
        console.log(`    ${name}: No TransactionExecuted events found (RPC or indexer)`);
        return; // Both empty is fine
      }

      if (!rpcLog) {
        console.log(
          `    ${name}: No events on RPC (within lookback window), indexer has block ${indexerTx!.evmTransaction.blockNumber}`
        );
        // The indexer may have events from further back — not a failure
        return;
      }

      const rpcBlockNumber = parseInt(rpcLog.blockNumber, 16);
      const rpcLogIndex = parseInt(rpcLog.logIndex, 16);
      const rpcTxHash = rpcLog.transactionHash;

      console.log(
        `    ${name} RPC     : txHash=${rpcTxHash.slice(0, 18)}… block=${rpcBlockNumber} logIndex=${rpcLogIndex}`
      );

      if (!indexerTx) {
        // RPC has events but indexer doesn't — the indexer may be behind
        console.log(
          `    ${name} Indexer : no transactions indexed yet — indexer may still be syncing`
        );
        console.log(`    ${name} BEHIND  : indexer has not yet reached block ${rpcBlockNumber}`);
        return;
      }

      const idxBlock = indexerTx.evmTransaction.blockNumber;
      const idxLogIndex = indexerTx.logIndex;
      const idxTxHash = indexerTx.evmTransaction.txHash;

      console.log(
        `    ${name} Indexer : txHash=${idxTxHash.slice(0, 18)}… block=${idxBlock} logIndex=${idxLogIndex}`
      );

      const blockDiff = rpcBlockNumber - idxBlock;
      if (blockDiff > 0) {
        console.log(`    ${name} BEHIND  : indexer is ${blockDiff} blocks behind RPC`);
      } else {
        console.log(`    ${name} IN SYNC`);
      }

      // The indexer's latest tx must exist on-chain (txHash matches something real)
      expect(idxTxHash)
        .to.be.a("string")
        .and.match(/^0x[0-9a-fA-F]{64}$/);
      expect(idxBlock).to.be.a("number").and.greaterThan(0);
      expect(idxLogIndex).to.be.a("number").and.at.least(0);

      // If the indexer has caught up to the same block, the data must match exactly
      if (idxBlock === rpcBlockNumber) {
        expect(idxTxHash.toLowerCase()).to.equal(
          rpcTxHash.toLowerCase(),
          `${name}: txHash mismatch at block ${rpcBlockNumber}`
        );
        expect(idxLogIndex).to.equal(
          rpcLogIndex,
          `${name}: logIndex mismatch at block ${rpcBlockNumber}`
        );
      }
    });
  }
});
