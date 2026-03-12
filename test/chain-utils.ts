/**
 * Shared chain utilities — all derived from config.yaml, nothing hardcoded.
 *
 * Chain names are parsed from YAML inline comments (e.g., "- id: 1 # Mainnet").
 * RPC URLs come from env vars or config.yaml rpc_config — no fallback defaults.
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";

export interface NetworkConfig {
  id: number;
  start_block: number;
  rpc_config?: { url: string };
  contracts: Array<{ name: string; address: string[] }>;
}

export interface Config {
  networks: NetworkConfig[];
}

/**
 * Parse config.yaml and return network configs.
 */
export function parseConfig(configPath?: string): NetworkConfig[] {
  const p = configPath ?? path.resolve(__dirname, "..", "config.yaml");
  const raw = fs.readFileSync(p, "utf-8");
  return (yaml.parse(raw) as Config).networks;
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
  if (network.rpc_config?.url) {
    return network.rpc_config.url;
  }
  return undefined;
}

/**
 * Make a JSON-RPC call to an EVM node.
 */
export async function rpcCall(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) {
    throw new Error(`RPC HTTP ${res.status}: ${method} to ${rpcUrl}`);
  }
  const text = await res.text();
  if (!text) {
    throw new Error(`RPC empty response: ${method} to ${rpcUrl}`);
  }
  const json = JSON.parse(text) as {
    result?: unknown;
    error?: { message: string; code?: number };
  };
  if (json.error) {
    throw new Error(`RPC error: ${json.error.message}`);
  }
  return json.result;
}

export function toHex(n: number): string {
  return `0x${n.toString(16)}`;
}
