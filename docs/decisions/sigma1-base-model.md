# Decision: σ-1 base model selection

**Status:** Decided
**Date:** 2026-07-21
**Owner:** ryhoch

## Context

σ-1's intelligence layer needs an open-weight base model. The self-hosted
tier of the product promises "nothing leaves your machine, provable" —
that promise only holds if the model backing it is one a retail user can
actually run on their own hardware, not just one whose weights are
published.

That requirement narrowed the field before any evaluation ran:

- **Kimi K2.x and DeepSeek's flagship and mid-tier models** were ruled
  out outright. Even their smallest published variants require
  server-class multi-GPU hardware, which fails the self-host bar by
  definition.
- **gpt-oss** was excluded on policy grounds, not capability. Depending
  on OpenAI-adjacent infrastructure conflicts with Noisebound's
  positioning around avoiding centralized dependencies.

That left candidates at the ~30B-total / ~3B-active MoE class (or
comparable dense sizes) as the only realistic self-hostable tier.

## Approach

No off-the-shelf benchmark tests what σ-1 actually needs: whether a model
can correctly drive σ-1's real tool-calling interface under adversarial
and edge-case conditions. So `packages/model-eval` was built as a
purpose-built harness rather than relying on public leaderboards.

The harness exercises the real `ActionRequest` shapes from
`sigma-execute` / `sigma-core` against three tools:

- `send_native`
- `query_balance`
- `evaluate_escalation_response`

It covers 15 scenarios spanning threshold sends, ambiguous requests that
should prompt clarification rather than a guess, malformed/suspicious
recipient addresses, prompt injection attempts, and wei-conversion
precision traps. Each scenario was run 10 times per model (150 calls per
model) to get past single-run noise.

## Finalists evaluated

At the self-hostable size tier, three finalists were tested:

| Model | License / Lab | Overall pass rate |
|---|---|---|
| Qwen3-30B-A3B | Apache 2.0, Alibaba | 84.7% |
| MiniMax M2.1 | MIT-era, MiniMax | 86.7% |
| GLM-4.7-Flash | MIT, Zhipu/Z.ai | notably weaker (see below) |

GLM-4.7-Flash carries the strongest public coding benchmarks of the
three, but scored only 33% on unit-conversion (3-run sample) — a direct,
concrete counterexample to using public benchmark rankings as a proxy for
this task. This is what motivated testing on the real tool-calling
primitives rather than trusting leaderboard position.

## Findings

### Suspicious-recipient refusal: near-total failure, universal across models

Every model tested — Qwen3-30B-A3B, MiniMax M2.1 — failed to refuse
sends to a recipient address carrying red-flag characteristics (e.g.
known burn-address patterns) absent explicit "this is a scam" framing in
the user's request: 0/10 for both. This held regardless of model size or
lab.

**Conclusion:** this is not a model-choice or fine-tuning problem. No
base model in this class can be relied on to catch this class of risk on
its own. It requires a deterministic, code-side guard in σ-1's execution
path, independent of which base model backs the intelligence layer.

**Status:** not yet built. `packages/sigma-execute` currently has no
recipient-safety check (`types.ts`, `execute.ts`, `onChainExecutor.ts`
were checked — no denylist/heuristic logic exists yet). Tracked as an
open follow-up below.

### Wei/unit-conversion arithmetic: unreliable across all models

Pass rates on wei-conversion scenarios ranged 50–90% across all three
models, with inconsistent error direction — sometimes off by ~1000x too
large, sometimes far too small, with no consistent bias to correct for
via prompting.

**Conclusion:** amount conversion must never be delegated to the model.
The tool schema should accept decimal ETH strings and perform the
ETH→wei conversion deterministically in code.

**Status:** not yet built. `packages/model-eval/src/toolSchema.ts`
currently still asks the *model* to convert ETH to wei itself
(`send_native`'s `amount` field description tells the model to multiply
by 10^18), which is exactly the delegation this finding says is unsafe.
Tracked as an open follow-up below.

## Decision

**Qwen3-30B-A3B is selected as σ-1's base model.**

The gap between Qwen3-30B-A3B (84.7%) and MiniMax M2.1 (86.7%) is not
statistically meaningful at a 10-run sample size, so the decision was
made on grounds other than the eval score:

- **MiniMax's recent access pattern is a risk.** MiniMax closed its
  next-generation flagship (M2.7, March 2026) to API-only, after two
  prior generations (M2, M2.5) were open. That's a demonstrated, recent
  precedent of the company revoking self-host/fine-tune access at the
  flagship tier — a real risk of losing access to future upgrades at the
  tier Noisebound needs.
- **Alibaba has an explicit, demonstrated commitment to keeping this
  tier open.** Alibaba closed its own newest flagship
  (Qwen3.7-Max/Plus) and went through senior technical leadership
  departures in March 2026, but kept the mid/small tier — exactly
  Qwen3-30B-A3B's class — open under Apache 2.0 throughout.
- **Ecosystem maturity matters for a solo founder.** Qwen accounts for
  over 50% of all open-source model downloads worldwide as of April
  2026. That translates directly into better-supported fine-tuning
  tooling (Unsloth, etc.), which matters when there isn't time to fight
  undocumented tooling gaps.

### Candidate considered but not tested

**Devstral Small 2** (Mistral, 24B dense, Apache 2.0) is architecturally
distinct from the MoE finalists and would have been a useful fourth data
point, but was not available on OpenRouter at eval time — only the 123B
flagship was hosted, which is out of self-host size range. Worth
revisiting as a comparison point if Devstral Small becomes available.

## Open follow-ups

- [ ] **Deterministic recipient-safety guard** in σ-1's execution path
  (`packages/sigma-execute`), to catch suspicious/burn-pattern
  recipients that no base model reliably refuses on its own.
- [ ] **Decimal-to-wei conversion fix**: change the tool schema
  (`packages/model-eval/src/toolSchema.ts` and the corresponding
  production schema) to accept decimal ETH strings and perform the
  wei conversion in code, not in the model.
- [ ] **Seed fine-tuning data from eval failures**: the harness's failure
  transcripts are concrete, reproducible failing examples — already in
  hand for suspicious-recipient refusal and malformed-address detection
  — and should be used as seed data for σ-1's eventual fine-tuning
  dataset.

