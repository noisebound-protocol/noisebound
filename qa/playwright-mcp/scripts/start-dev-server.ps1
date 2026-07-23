# Starts the app dev server pre-configured for the Playwright MCP QA harness:
# Base Sepolia network, dev funder key, and an isolated recipient-history file
# seeded with fixtures/recipient-history.seed.json so send-flow specs get
# deterministic single-confirmation vs secondary-confirmation behavior.
$ErrorActionPreference = "Stop"

$HarnessDir = Split-Path -Parent $PSScriptRoot
$RepoRoot = Resolve-Path (Join-Path $HarnessDir "..\..")
$ScratchDir = Join-Path $HarnessDir ".scratch"
$RecipientHistoryPath = Join-Path $ScratchDir "recipient-history.json"

New-Item -ItemType Directory -Force -Path $ScratchDir | Out-Null
Copy-Item (Join-Path $HarnessDir "fixtures\recipient-history.seed.json") $RecipientHistoryPath -Force

if (-not $env:NEXT_PUBLIC_NOISEBOUND_NETWORK) { $env:NEXT_PUBLIC_NOISEBOUND_NETWORK = "base-sepolia" }
if (-not $env:NOISEBOUND_DEV_FUNDER_PRIVATE_KEY) { $env:NOISEBOUND_DEV_FUNDER_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" }
$env:NOISEBOUND_RECIPIENT_HISTORY_PATH = $RecipientHistoryPath

Write-Host "Starting app dev server on http://localhost:3000"
Write-Host "  NEXT_PUBLIC_NOISEBOUND_NETWORK=$env:NEXT_PUBLIC_NOISEBOUND_NETWORK"
Write-Host "  NOISEBOUND_RECIPIENT_HISTORY_PATH=$env:NOISEBOUND_RECIPIENT_HISTORY_PATH"

Set-Location (Join-Path $RepoRoot "apps\app")
pnpm dev