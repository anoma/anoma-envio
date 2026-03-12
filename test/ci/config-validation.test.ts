/**
 * Config Validation: verify config.yaml entries against on-chain state.
 *
 * For every network in config.yaml this checks:
 *   1. RPC is reachable (eth_blockNumber returns a valid number)
 *   2. Contract is deployed (eth_getCode at latest is not "0x")
 *   3. start_block is valid (contract had code at start_block)
 *   4. start_block is not too early (warns if contract had code at start_block - 1)
 *
 * Usage:
 *   pnpm test -- --grep "Config Validation"
 */

import { expect } from "chai";
import * as yaml from "yaml";
import * as fs from "fs";
import * as path from "path";

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

function getRpcUrl(network: NetworkConfig): string | undefined {
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

function parseConfig(): NetworkConfig[] {
  const configPath = path.resolve(__dirname, "..", "..", "config.yaml");
  const raw = fs.readFileSync(configPath, "utf-8");
  const config = yaml.parse(raw) as Config;
  return config.networks;
}

async function rpcCall(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as {
    result?: unknown;
    error?: { message: string };
  };
  if (json.error) {
    throw new Error(`RPC error: ${json.error.message}`);
  }
  return json.result;
}

function toHex(n: number): string {
  return `0x${n.toString(16)}`;
}

describe("Config Validation: config.yaml vs on-chain state", function () {
  this.timeout(120_000);

  const networkConfigs = (() => {
    try {
      return parseConfig();
    } catch {
      return [];
    }
  })();

  it("should have networks loaded from config", function () {
    expect(networkConfigs).to.be.an("array").with.length.greaterThan(0);
    console.log(`\n  Loaded ${networkConfigs.length} networks from config.yaml`);
  });

  for (const network of networkConfigs) {
    const name = chainName(network.id);
    const rpcUrl = getRpcUrl(network);
    const contractAddress = network.contracts[0]?.address[0];

    describe(`[${name}] (chain ${network.id})`, function () {
      if (!rpcUrl) {
        it("should have an RPC URL configured", function () {
          expect.fail(
            `No RPC URL found for ${name} (chain ${network.id}). ` +
              `Set RPC_${chainName(network.id)
                .toUpperCase()
                .replace(/[^A-Z0-9]+/g, "_")} ` +
              `or add rpc_config.url to config.yaml.`
          );
        });
        return;
      }

      if (!contractAddress) {
        it("should have a contract address configured", function () {
          expect.fail(`No contract address found for ${name} (chain ${network.id})`);
        });
        return;
      }

      it("RPC reachable: eth_blockNumber returns a valid block number", async function () {
        const hex = (await rpcCall(rpcUrl, "eth_blockNumber", [])) as string;
        const blockNumber = parseInt(hex, 16);
        expect(blockNumber).to.be.a("number").and.greaterThan(0);
        console.log(`    ${name}: chain tip = ${blockNumber}`);
      });

      it("Contract deployed: eth_getCode at latest is not empty", async function () {
        const code = (await rpcCall(rpcUrl, "eth_getCode", [contractAddress, "latest"])) as string;
        expect(code).to.be.a("string");
        expect(code).to.not.equal("0x", `${name}: no bytecode at ${contractAddress} (latest)`);
        expect(code.length).to.be.greaterThan(2, `${name}: empty bytecode at ${contractAddress}`);
        console.log(
          `    ${name}: contract ${contractAddress} has ${code.length - 2} hex chars of bytecode`
        );
      });

      it("start_block is valid: contract has code right after start_block", async function () {
        // eth_getCode at block N returns state at the START of block N.
        // If the contract was deployed IN block N, code only appears at block N+1.
        const checkBlock = network.start_block + 1;
        const code = (await rpcCall(rpcUrl, "eth_getCode", [
          contractAddress,
          toHex(checkBlock),
        ])) as string;
        expect(code).to.be.a("string");
        expect(code).to.not.equal(
          "0x",
          `${name}: no bytecode at ${contractAddress} at block ${checkBlock} (start_block + 1). ` +
            `The contract may not have been deployed at start_block ${network.start_block}, ` +
            `or the RPC does not support archive queries.`
        );
        expect(code.length).to.be.greaterThan(2, `${name}: empty bytecode at block ${checkBlock}`);
        console.log(`    ${name}: contract has code at block ${checkBlock} (start_block + 1)`);
      });

      it("start_block is not too early: check code at start_block - 1", async function () {
        if (network.start_block <= 0) {
          console.log(`    ${name}: start_block is 0, skipping prior-block check`);
          return;
        }
        const priorBlockHex = toHex(network.start_block - 1);
        const code = (await rpcCall(rpcUrl, "eth_getCode", [
          contractAddress,
          priorBlockHex,
        ])) as string;
        if (code && code !== "0x" && code.length > 2) {
          console.log(
            `    ${name}: WARNING — contract had code at block ${network.start_block - 1} ` +
              `(one before start_block). start_block might be set after the actual deployment.`
          );
        } else {
          console.log(
            `    ${name}: no code at block ${network.start_block - 1} — start_block looks correct`
          );
        }
      });
    });
  }
});
