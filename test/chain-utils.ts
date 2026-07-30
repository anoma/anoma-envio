/**
 * Shared chain utilities — all derived from config.yaml, nothing hardcoded.
 *
 * Chain names are parsed from YAML inline comments (e.g., "- id: 1 # Mainnet").
 * RPC URLs come from env vars or config.yaml rpc.url — no fallback defaults.
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";

export interface NetworkConfig {
  id: number;
  start_block: number;
  rpc?: { url: string };
  contracts: Array<{ name: string; address: string[] }>;
}

export interface Config {
  chains: NetworkConfig[];
}

/**
 * Parse config.yaml and return network configs.
 */
export function parseConfig(configPath?: string): NetworkConfig[] {
  const p = configPath ?? path.resolve(__dirname, "..", "config.yaml");
  const raw = fs.readFileSync(p, "utf-8");
  return (yaml.parse(raw) as Config).chains;
}

/**
 * Extract chain names from config.yaml inline comments.
 * Parses lines like "  - id: 1 # Mainnet" -> {1: "Mainnet"}
 */
export function parseChainNames(configPath?: string): Record<number, string> {
  const p = configPath ?? path.resolve(__dirname, "..", "config.yaml");
  const raw = fs.readFileSync(p, "utf-8");
  const names: Record<number, string> = {};
  for (const line of raw.split("\n")) {
    const match = line.match(/^\s*-\s*id:\s*(\d+)\s*#\s*(.+)/);
    if (match) {
      names[parseInt(match[1])] = match[2].trim();
    }
  }
  return names;
}

let _chainNames: Record<number, string> | undefined;

/**
 * Get human-readable chain name from config.yaml comments.
 * Falls back to "Chain <id>" if no comment found.
 */
export function chainName(id: number): string {
  if (!_chainNames) {
    _chainNames = parseChainNames();
  }
  return _chainNames[id] ?? `Chain ${id}`;
}

/**
 * Get the RPC env var key for a chain: RPC_<UPPER_NAME>.
 * e.g., chain "Base Sepolia" -> "RPC_BASE_SEPOLIA"
 */
export function rpcEnvKey(id: number): string {
  const name = chainName(id)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
  return `RPC_${name}`;
}

/**
 * Get RPC URL for a network. Priority:
 * 1. RPC_<NAME> env var (e.g. RPC_SEPOLIA)
 * 2. RPC_<chainId> env var (e.g. RPC_11155111)
 * 3. rpc_config.url from config.yaml
 * 4. undefined (caller decides what to do)
 */
export function getRpcUrl(network: NetworkConfig): string | undefined {
  const nameKey = rpcEnvKey(network.id);
  if (process.env[nameKey]) {
    return process.env[nameKey];
  }
  const idKey = `RPC_${network.id}`;
  if (process.env[idKey]) {
    return process.env[idKey];
  }
  if (network.rpc?.url) {
    return network.rpc.url;
  }
  return undefined;
}

/**
 * Make a JSON-RPC call to an EVM node with retry on rate limits.
 */
export async function rpcCall(
  rpcUrl: string,
  method: string,
  params: unknown[],
  retries = 2
): Promise<unknown> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (res.status === 429 && attempt < retries) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) {
      const err = new Error(`RPC HTTP ${res.status}: ${res.statusText}`) as Error & {
        code: number;
      };
      err.code = res.status;
      throw err;
    }
    const text = await res.text();
    if (!text) {
      throw new Error("RPC empty response");
    }
    const json = JSON.parse(text) as {
      result?: unknown;
      error?: { message: string; code?: number };
    };
    if (json.error) {
      if (/compute units|rate limit/i.test(json.error.message) && attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      const err = new Error(`RPC error: ${json.error.message}`) as Error & { code?: number };
      err.code = json.error.code;
      throw err;
    }
    return json.result;
  }
  throw new Error(`RPC call failed after ${retries + 1} attempts`);
}

export function toHex(n: number): string {
  return `0x${n.toString(16)}`;
}
