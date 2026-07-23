# Phase 3 QA harness: Playwright MCP browser tests

Agent-driven, MCP-based browser tests for two UI flows only:

- **wallet-import** — identity create/import, dashboard balance display,
  session-key issuance (`specs/01-wallet-import.md`)
- **money-send** — the send form through to the confirmation dialog, both
  single- and secondary-confirmation UI states (`specs/02-money-send.md`)

Both target **Base Sepolia only**. Assertions are on UI state and displayed
values — never on on-chain finality. The one on-chain step this harness
touches (session-key funding) is asserted as "reached a valid terminal UI
state," not "the funding tx confirmed." Live-broadcast / finality testing is
a separate, out-of-scope test suite.

## Why "MCP-based" instead of plain `@playwright/test` scripts

These specs are written as step-by-step prompts (`specs/*.md`) for an agent
to execute using the Playwright MCP server's browser tools (navigate, click,
type, snapshot, wait), asserting on the accessibility snapshot / visible text
at each step — not as compiled `@playwright/test` selectors run headlessly
without a model in the loop.

**Cost tradeoff, please read before wiring this into CI:** driving the
browser through an LLM via Playwright MCP costs roughly **4x the tokens** of
an equivalent CLI-driven Playwright script (codegen'd `@playwright/test`
with fixed selectors, no model in the loop). That's an acceptable cost for
the judgment-heavy assertions in these two flows (reading dialog copy,
distinguishing confirmation states) run occasionally, but not for running on
every PR. **Recommendation: schedule this suite nightly, not per-PR.** This
harness is intentionally not wired into CI yet — see "Not yet automated"
below.

## Prerequisites

- `pnpm install` at the repo root, then build workspace packages:
  `pnpm turbo run build --filter=@noisebound/app^...`
- The Playwright MCP server available (registered in the repo's `.mcp.json`
  as `playwright`, launched via `npx @playwright/mcp@latest --headless`) and
  Chromium installed for it (`npx playwright install chromium` if the MCP
  server's first launch doesn't do this for you).

## Running locally

1. Start the app dev server pre-configured for this harness:
   ```
   bash qa/playwright-mcp/scripts/start-dev-server.sh   # or scripts\start-dev-server.ps1 on Windows
   ```
   This sets `NEXT_PUBLIC_NOISEBOUND_NETWORK=base-sepolia`, a dev funder key
   (Hardhat's well-known, intentionally-unfunded account #0 — see
   `apps/app/lib/fixtures/devWallet.ts`), and points
   `NOISEBOUND_RECIPIENT_HISTORY_PATH` at a disposable copy of
   `fixtures/recipient-history.seed.json` so send-flow specs get
   deterministic known/unknown-recipient behavior without mutating the
   repo's real `.data/` directory.
2. In a Claude Code session with the Playwright MCP server connected, open
   `specs/01-wallet-import.md` and `specs/02-money-send.md` and have the
   agent execute each case using the MCP browser tools, checking off each
   assertion against the live page.
3. Between wallet-import cases, clear the browser's localStorage for
   `localhost:3000` (identity and session capabilities persist there) — each
   case says when it needs a fresh context.

## Fixtures

- `fixtures/identity-keypair.valid.json` — a real ML-DSA-65 identity keypair
  generated offline via `@noisebound/identity` (`generateIdentityKeyPair` +
  `serializeIdentityKeyPair`), used to exercise the "import identity"
  success path deterministically.
- `fixtures/identity-keypair.malformed.json` — missing the required
  `secretKey` field, for the import-validation-error case.
- `fixtures/recipient-history.seed.json` — one pre-seeded "known" recipient
  address, so send-flow tests can hit the amount-threshold path without
  every first-time address forcing secondary confirmation via the novelty
  gate.
- `fixtures/qa.env.example` — documents the env vars the start scripts set;
  copy to a local `.env` if you want to run the dev server without the
  wrapper scripts.

## Not yet automated

This harness is local-only for now. It is deliberately **not** wired into
any CI workflow in this PR — per the cost tradeoff above, the follow-up work
is a scheduled (nightly) job, not a per-PR check.
