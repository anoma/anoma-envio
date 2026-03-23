#!/usr/bin/env bash
set -euo pipefail

# Configure config.yaml for CI all-chains integration test.
# Injects Alchemy RPC URLs (from ALCHEMY_API_KEY env var) for chains
# that don't have rpc_config, and sets start_block near each chain's tip.

CONFIG="${1:-config.yaml}"
LOOKBACK="${LOOKBACK:-5000}"

if [ ! -f "$CONFIG" ]; then
  echo "Error: $CONFIG not found" >&2
  exit 1
fi

if [ -z "${ALCHEMY_API_KEY:-}" ]; then
  echo "Error: ALCHEMY_API_KEY env var is required" >&2
  exit 1
fi

if ! command -v yq &>/dev/null; then
  echo "Error: yq is required (https://github.com/mikefarah/yq)" >&2
  exit 1
fi

# Alchemy slugs (same as generate-ci-matrix.sh)
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
echo "Configuring $NETWORK_COUNT networks in $CONFIG..."

for i in $(seq 0 $((NETWORK_COUNT - 1))); do
  CHAIN_ID=$(yq ".networks[$i].id" "$CONFIG")
  EXISTING_RPC=$(yq ".networks[$i].rpc_config.url // \"\"" "$CONFIG")

  # Determine RPC URL
  if [ -n "$EXISTING_RPC" ]; then
    RPC_URL="$EXISTING_RPC"
    echo "  Chain $CHAIN_ID: using existing rpc_config ($RPC_URL)"
  elif [ -n "${ALCHEMY_SLUGS[$CHAIN_ID]:-}" ]; then
    RPC_URL="https://${ALCHEMY_SLUGS[$CHAIN_ID]}.g.alchemy.com/v2/${ALCHEMY_API_KEY}"
    export RPC_URL
    yq -i ".networks[$i].rpc_config.url = env(RPC_URL)" "$CONFIG"
    echo "  Chain $CHAIN_ID: injected Alchemy RPC (${ALCHEMY_SLUGS[$CHAIN_ID]})"
  else
    echo "  Chain $CHAIN_ID: WARNING — no RPC available, skipping start_block update"
    continue
  fi

  # Get chain tip and set start_block near it
  TIP_HEX=$(curl -sf "$RPC_URL" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
    | jq -r '.result')

  if [ -z "$TIP_HEX" ] || [ "$TIP_HEX" = "null" ]; then
    echo "  Chain $CHAIN_ID: WARNING — could not get chain tip, skipping"
    continue
  fi

  TIP=$((TIP_HEX))
  RECENT_START=$((TIP - LOOKBACK))
  export RECENT_START
  yq -i ".networks[$i].start_block = env(RECENT_START)" "$CONFIG"
  echo "  Chain $CHAIN_ID: tip=$TIP, start_block=$RECENT_START"
done

# Remove transaction_fields not available via RPC
yq -i '.field_selection.transaction_fields -= ["gasUsed", "status"]' "$CONFIG"

echo ""
echo "Final config:"
cat "$CONFIG"
