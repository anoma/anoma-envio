#!/usr/bin/env bash
set -euo pipefail

# Generates GitHub Actions matrix JSON from config.yaml.
# The chain list is derived entirely from config.yaml — no hardcoded values.
# Each network entry must have an inline comment with the chain name:
#   - id: 1 # Mainnet
#
# For chains without rpc_config in config.yaml (HyperSync chains),
# CI needs an archive RPC for start_block validation. These are provided
# via Alchemy (requires ALCHEMY_API_KEY env var). If a chain has no
# rpc_config and no Alchemy support, CI will fail with a clear message.

CONFIG="${1:-config.yaml}"

if [ ! -f "$CONFIG" ]; then
  echo "Error: $CONFIG not found" >&2
  exit 1
fi

# Well-known Alchemy network slugs for archive RPC access.
# Used in CI validation for chains that need archive queries (eth_getCode at historical blocks).
declare -A ALCHEMY_SLUGS=(
  [1]="eth-mainnet"
  [42161]="arb-mainnet"
  [8453]="base-mainnet"
  [10]="opt-mainnet"
  [56]="bnb-mainnet"
  [143]="monad-mainnet"
  [11155111]="eth-sepolia"
  [84532]="base-sepolia"
)

# Extract rpc_config URLs from config.yaml using yq (if available)
declare -A CONFIG_RPCS
if command -v yq &>/dev/null; then
  while IFS='=' read -r cid url; do
    if [ -n "$url" ] && [ "$url" != "null" ]; then
      CONFIG_RPCS[$cid]="$url"
    fi
  done < <(yq -r '.networks[] | "\(.id)=\(.rpc_config.url // "null")"' "$CONFIG")
fi

ENTRIES=()
while IFS= read -r line; do
  # Match "  - id: <number> # <name>" lines in config.yaml
  if [[ "$line" =~ ^[[:space:]]*-[[:space:]]*id:[[:space:]]*([0-9]+)[[:space:]]*#[[:space:]]*(.*) ]]; then
    CHAIN_ID="${BASH_REMATCH[1]}"
    RAW_NAME="${BASH_REMATCH[2]}"
    # Display name: spaces -> hyphens (for GitHub Actions job names)
    DISPLAY_NAME=$(echo "$RAW_NAME" | sed 's/ /-/g')
    # RPC env key: uppercase, non-alphanumeric -> underscore (matches test/chain-utils.ts)
    RPC_KEY=$(echo "$RAW_NAME" | tr '[:lower:]' '[:upper:]' | sed 's/[^A-Z0-9]/_/g')

    # Determine RPC URL: from config.yaml rpc_config first
    RPC_URL="${CONFIG_RPCS[$CHAIN_ID]:-}"

    ENTRY="{\"chain_id\":$CHAIN_ID,\"name\":\"$DISPLAY_NAME\",\"rpc_key\":\"$RPC_KEY\""
    if [ -n "$RPC_URL" ]; then
      ENTRY+=",\"rpc_url\":\"$RPC_URL\""
    fi
    # Add Alchemy slug for chains that support it (used to construct archive RPC URL in CI)
    if [ -n "${ALCHEMY_SLUGS[$CHAIN_ID]:-}" ]; then
      ENTRY+=",\"alchemy\":\"${ALCHEMY_SLUGS[$CHAIN_ID]}\""
    fi
    ENTRY+="}"
    ENTRIES+=("$ENTRY")
  fi
done < "$CONFIG"

if [ ${#ENTRIES[@]} -eq 0 ]; then
  echo "Error: no networks found in $CONFIG" >&2
  exit 1
fi

# Join entries with commas
IFS=','
echo "{\"include\":[${ENTRIES[*]}]}"
