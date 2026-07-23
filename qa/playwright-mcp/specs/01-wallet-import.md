# Spec: wallet-import click-through (Base Sepolia)

Scope: identity creation/import ("connect"), balance display, and session-key
issuance. This is the only "wallet connect" concept in the app today — there
is no browser-extension wallet flow; `apps/app/lib/fixtures/devWallet.ts`
explicitly notes that's future work.

Preconditions:
- Dev server running via `scripts/start-dev-server.sh` (or `.ps1`), which
  sets `NEXT_PUBLIC_NOISEBOUND_NETWORK=base-sepolia` and points
  `NOISEBOUND_RECIPIENT_HISTORY_PATH` at a scratch fixture copy.
- Browser session has no prior localStorage state for this app (use a fresh
  Playwright MCP browser context / clear localStorage for `localhost:3000`
  before starting, since identity + session capabilities persist there).

Run each numbered case with a fresh browser context (localStorage cleared)
unless it says otherwise.

## Case A — reject malformed import JSON

1. Navigate to `http://localhost:3000/`.
2. Assert the page shows a button named "Get started" and a button named
   "Import identity" (this is the only entry point — there is no separate
   wallet-connect button).
3. Click "Import identity". Assert a textarea and buttons "Import" / "Cancel"
   appear.
4. Type `not valid json` into the textarea and click "Import".
5. Assert error text "That doesn't look like valid identity key JSON."
   appears and the page is still `/`.
6. Clear the textarea, paste the contents of
   `fixtures/identity-keypair.malformed.json`, click "Import".
7. Assert error text "Expected an object with \"publicKey\" and \"secretKey\"
   base64 fields." appears.

## Case B — create a new identity ("connect")

1. Navigate to `http://localhost:3000/` with a fresh context.
2. Click "Get started".
3. Assert the browser navigates to `/dashboard`.
4. Assert the dashboard shows heading "Dashboard" and a network badge
   reading "Base Sepolia" (confirms `NEXT_PUBLIC_NOISEBOUND_NETWORK` wiring —
   `packages/networks` chainId 84532).
5. Assert the balances section shows the empty state: text "No active
   session key yet — issue one to fund your agent." and a link/button
   "Issue a session key".

## Case C — import a valid identity

1. Navigate to `http://localhost:3000/` with a fresh context.
2. Click "Import identity", paste the contents of
   `fixtures/identity-keypair.valid.json` into the textarea, click "Import".
3. Assert navigation to `/dashboard` with no error text shown.
4. Assert the same empty-balances state as Case B step 5 (this fixture
   identity has no session key yet).

## Case D — issue a session key, then observe balance display

Continue from Case B or C (an identity must already be saved).

1. From `/dashboard`, click "Issue a session key" (or navigate to
   `/sessions` directly).
2. Fill the form: label input (`#session-label`) with `qa-smoke`, "Max spend
   scope (ETH)" input (`#session-max-spend`) with `0.5`, "Duration" select
   (`#session-duration`) — leave default or pick "1 hour".
3. Click "Issue session key". Assert the button's label changes to
   "Issuing…" and is disabled while pending.
4. Wait for the request to settle, then assert **one** of these terminal
   states (both are valid, deterministic UI outcomes on Base Sepolia — which
   one occurs depends on whether the dev funder address currently holds
   Base Sepolia test ETH; this harness only asserts UI state, not on-chain
   finality, so either is a pass as long as the UI matches exactly):
   - Success: text matching `/Issued and funded/` appears, and the new
     capability appears in the session list on `/sessions`.
   - Funding error: an error banner appears with the underlying revert/RPC
     message; assert the form does NOT silently show success and does NOT
     crash (no unhandled exception overlay).
5. Navigate to `/dashboard`. If issuance succeeded, assert the balances
   section now renders a `BalanceCard` with numeric native (ETH) and USDC
   values (format `\d+\.\d+`) instead of the empty state — do not assert
   exact amounts, only that both fields render as numbers and the loading
   state ("Loading balances…") resolves.

## Out of scope

- Actually spending/sending from the issued session key (covered by
  `02-money-send.md`, which itself stops before broadcast).
- Verifying the funding transaction lands on-chain (separate live-broadcast
  test, per the Phase 3 QA plan).
- `base-mainnet` — this harness is Base Sepolia only.