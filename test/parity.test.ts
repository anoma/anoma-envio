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
  // Env var override: RPC_<NAME> (e.g. RPC_SEPOLIA) or RPC_<chainId>
  const name = chainName(network.id)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
  const nameKey = `RPC_${name}`;
  if (process.env[nameKey]) {
    return process.env[nameKey];
  }
  const idKey = `RPC_${network.id}`;
  if (process.env[idKey]) {
    return process.env[idKey];
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
      expect(idxTxHash)
        .to.be.a("string")
        .and.match(/^0x[0-9a-fA-F]{64}$/);
      expect(idxBlock).to.be.a("number").and.greaterThan(0);
      expect(idxLogIndex).to.be.a("number").and.at.least(0);

      // Verify the indexer's latest tx exists on-chain
      const rpcLogs = await getRpcLogsForBlock(rpcUrl, contractAddress, idxBlock);
      const matchingLog = rpcLogs.find(
        (log) => log.transactionHash.toLowerCase() === idxTxHash.toLowerCase()
      );

      expect(
        matchingLog,
        `${name}: indexer tx ${idxTxHash} not found on-chain at block ${idxBlock}`
      ).to.not.be.undefined;
      expect(parseInt(matchingLog!.logIndex, 16)).to.equal(
        idxLogIndex,
        `${name}: logIndex mismatch at block ${idxBlock}`
      );

      const blockDiff = chainTip - idxBlock;
      if (blockDiff > 0) {
        console.log(
          `    ${name} BEHIND  : indexer is ${blockDiff} blocks behind chain tip ${chainTip}`
        );
      } else {
        console.log(`    ${name} IN SYNC`);
      }
    });
  }
});
