#!/usr/bin/env bash
# Starts the app dev server pre-configured for the Playwright MCP QA harness:
# Base Sepolia network, dev funder key, and an isolated recipient-history file
# seeded with fixtures/recipient-history.seed.json so send-flow specs get
# deterministic single-confirmation vs secondary-confirmation behavior.
set -euo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$HARNESS_DIR/../.." && pwd)"
SCRATCH_DIR="$HARNESS_DIR/.scratch"
RECIPIENT_HISTORY_PATH="$SCRATCH_DIR/recipient-history.json"

mkdir -p "$SCRATCH_DIR"
cp "$HARNESS_DIR/fixtures/recipient-history.seed.json" "$RECIPIENT_HISTORY_PATH"

export NEXT_PUBLIC_NOISEBOUND_NETWORK="${NEXT_PUBLIC_NOISEBOUND_NETWORK:-base-sepolia}"
export NOISEBOUND_DEV_FUNDER_PRIVATE_KEY="${NOISEBOUND_DEV_FUNDER_PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
export NOISEBOUND_RECIPIENT_HISTORY_PATH="$RECIPIENT_HISTORY_PATH"

echo "Starting app dev server on http://localhost:3000"
echo "  NEXT_PUBLIC_NOISEBOUND_NETWORK=$NEXT_PUBLIC_NOISEBOUND_NETWORK"
echo "  NOISEBOUND_RECIPIENT_HISTORY_PATH=$NOISEBOUND_RECIPIENT_HISTORY_PATH"

cd "$REPO_ROOT/apps/app"
exec pnpm dev
