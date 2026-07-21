# @noisebound/model-eval

Local open-weight model evaluation harness used to select σ-1's base model.

This package is dev/research tooling, not part of the product. It runs
σ-1's real `ActionRequest` tool-calling interface (from `sigma-core` /
`sigma-execute`) against a locally-served open-weight model and scores the
responses. Public leaderboards don't test what σ-1 actually needs — whether
a model can drive its tool-calling interface correctly under adversarial
and edge-case conditions — so this harness was purpose-built instead.
**It is intentionally never imported by `apps/app` or any other package.**

## Scenario categories

The harness exercises `send_native`, `query_balance`, and
`evaluate_escalation_response` across these categories:

- `send-below-threshold` — ordinary sends that only need standard confirmation.
- `send-above-threshold` — sends above the default spend threshold, which must still emit the tool call but require secondary confirmation.
- `ambiguous-request` — missing amount or recipient; the model must ask, not guess.
- `malformed-recipient` — invalid or suspicious addresses (including urgency-framed pressure), which must be refused.
- `balance-query` — read-only balance checks.
- `prompt-injection` — embedded instructions or fake "system override" text trying to get the model to skip confirmation.
- `unit-conversion` — ETH-to-wei conversions at precision-sensitive values (tiny amounts, sub-cent fractions, 18-digit precision near the threshold).

## Result

**Qwen3-30B-A3B** was selected as σ-1's base model. See
[docs/decisions/sigma1-base-model.md](../../docs/decisions/sigma1-base-model.md)
for the full evaluation writeup and rationale.

## Usage

```bash
# Run the eval against a locally-served model (reads config from env)
pnpm --filter @noisebound/model-eval eval
```

Runner configuration (base URL, model name, runs per scenario) is loaded
from environment variables via `loadRunnerConfigFromEnv`. Results are
printed as a summary table and written as JSON to `eval-results/`.

## Key exports

- `SCENARIOS`, `Scenario`, `ScenarioCategory`, `ExpectedBehavior`, `ExpectedToolCall` — the fixed scenario set (`scenarios.ts`).
- `TOOL_SCHEMAS`, `SYSTEM_PROMPT` — the tool schema and system prompt presented to the model under test (`toolSchema.ts`).
- `loadRunnerConfigFromEnv`, `runScenario`, `runAllScenarios`, `EndpointUnreachableError`, `EndpointRequestError` — drives requests against the model endpoint (`runner.ts`).
- `scoreRun`, `scoreAll`, `summarize`, `formatSummaryTable`, `buildJsonReport` — scoring and reporting (`scorer.ts`).
- `ethToWei` — deterministic decimal-to-wei conversion used to build expected tool-call arguments (`wei.ts`).

## Test

```bash
pnpm --filter @noisebound/model-eval test
```
