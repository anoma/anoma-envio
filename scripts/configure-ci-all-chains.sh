#!/usr/bin/env bash
set -euo pipefail

# Configures config.yaml for CI integration tests with all chains.
# For each network:
#   1. Ensures rpc_config.url is set (adds Alchemy URL for HyperSync chains)
#   2. Sets start_block near chain tip for fast sync
#
# Requires: yq, curl, jq
# Environment: ALCHEMY_API_KEY (required for HyperSync chains)

CONFIG="${1:-config.yaml}"

if [ ! -f "$CONFIG" ]; then
  echo "Error: $CONFIG not found" >&2
  exit 1
fi

# Alchemy network slugs (must match generate-ci-matrix.sh)
declare -A ALCHEMY_SLUGS=(
  [1]="eth-mainnet"
  [42161]="arb-mainnet"
  [8453]="base-mainnet"
  [10]="opt-mainnet"
  [56]="bnb-mainnet"
  [97]="bnb-testnet"
  [11155111]="eth-sepolia"
  [84532]="base-sepolia"
)

NETWORK_COUNT=$(yq '.networks | length' "$CONFIG")
echo "Configuring $NETWORK_COUNT networks for CI..."

NEEDS_FIELD_CLEANUP=false

for i in $(seq 0 $((NETWORK_COUNT - 1))); do
  CHAIN_ID=$(yq ".networks[$i].id" "$CONFIG")
  EXISTING_RPC=$(yq ".networks[$i].rpc_config.url // \"\"" "$CONFIG")

  # Ensure rpc_config is set
  if [ -z "$EXISTING_RPC" ]; then
    SLUG="${ALCHEMY_SLUGS[$CHAIN_ID]:-}"
    if [ -n "$SLUG" ] && [ -n "${ALCHEMY_API_KEY:-}" ]; then
      RPC_URL="https://${SLUG}.g.alchemy.com/v2/${ALCHEMY_API_KEY}"
    else
      echo "Error: chain $CHAIN_ID has no rpc_config and no Alchemy slug/key available" >&2
      exit 1
    fi
    export RPC_URL
    yq -i ".networks[$i].rpc_config.url = env(RPC_URL)" "$CONFIG"
    NEEDS_FIELD_CLEANUP=true
    echo "  Chain $CHAIN_ID: added Alchemy RPC ($SLUG)"
  else
    RPC_URL="$EXISTING_RPC"
    echo "  Chain $CHAIN_ID: using existing RPC"
  fi

  # Get chain tip and set start_block near it
  TIP_HEX=$(curl -sf "$RPC_URL" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
    | jq -r '.result')
  TIP=$((TIP_HEX))
  RECENT_START=$((TIP - 5000))
  export RECENT_START
  yq -i ".networks[$i].start_block = env(RECENT_START)" "$CONFIG"
  echo "  Chain $CHAIN_ID: tip=$TIP, start_block=$RECENT_START"
done

# Remove transaction_fields only available via HyperSync (not via RPC)
if [ "$NEEDS_FIELD_CLEANUP" = true ]; then
  yq -i '.field_selection.transaction_fields -= ["gasUsed", "status"]' "$CONFIG"
  echo "Removed HyperSync-only transaction_fields"
fi

echo ""
echo "Final config.yaml:"
cat "$CONFIG"
