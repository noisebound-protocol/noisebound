# noisebound

[![CI](https://github.com/noisebound-protocol/noisebound/actions/workflows/ci.yml/badge.svg)](https://github.com/noisebound-protocol/noisebound/actions/workflows/ci.yml)

pnpm workspace monorepo managed with [Turborepo](https://turbo.build/repo).

## Packages

- `packages/attest`
- `packages/blind-pay`
- `packages/cloud-request`
- `packages/identity`
- `packages/memory-store`
- `packages/networks`
- `packages/observe-loop`
- `packages/pqc-wallet`
- `packages/sigma-core`
- `packages/sigma-execute`
- `packages/tee-provider`
- `packages/x402-pqc`

## Apps

- `apps/app`

## AI PR automation

`.github/workflows/claude-pr-automation.yml` runs [`anthropics/claude-code-action`](https://github.com/anthropics/claude-code-action) on every non-draft pull request (opened, updated, reopened, or marked ready for review). It is **comment-only**: it never merges, closes, approves, pushes commits, or edits files — it has no Edit/Write tools available to it, only read access to the diff and `gh pr comment`. It posts up to two comments per run:

1. **`## 🤖 Claude PR Review`** — a short code review (quality, obvious bugs, test coverage gaps) plus a docs-sync check: if a PR changes a package's source under `packages/<name>/` or `apps/<name>/` without touching that package's `README.md`, it's flagged here. This is informational only and is not a required/blocking check.
2. **`## 📝 Draft changelog entry`** — a machine-drafted changelog/ship-post entry generated from the PR's title, description, and commits. It is explicitly marked as a draft for a human to approve, edit, or delete — nothing is ever auto-published from it.

**Cost:** each PR event runs a single Claude Code session (bounded to 20 turns via `--max-turns`) that reads the diff and commit log and posts both comments. Every `synchronize` event (new push) re-runs it, so an active PR with several pushes will trigger several runs. Rough order of magnitude per run is a few cents to low tens of cents of Anthropic API usage depending on PR size and model; a `concurrency` guard cancels superseded runs on rapid pushes to avoid stacking up redundant ones. Requires an `ANTHROPIC_API_KEY` repo secret to be configured.
