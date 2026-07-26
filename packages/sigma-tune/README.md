# @noisebound/sigma-tune

LoRA/QLoRA fine-tuning scaffold for σ-1's base model.

This package is dev/research tooling, not part of the product — **it is
intentionally never imported by `apps/app` or any other package**, the same
rule `packages/model-eval` follows. It generates a tool-use fine-tuning
dataset for **Qwen3-30B-A3B** (selected as σ-1's base model; see
[docs/decisions/sigma1-base-model.md](../../docs/decisions/sigma1-base-model.md))
and provides an Unsloth-based QLoRA training config to train against it.

Unlike `model-eval` (which scores a served model's live tool calls against
scenarios), this package generates static supervised fine-tuning
*examples* — full chat transcripts with the correct tool call(s) and
final assistant reply already filled in — for the model to be trained on.

The dataset is grounded directly in σ-1's real execution primitives, not
an invented interface:

- **Session key issuance** — `@noisebound/pqc-wallet`'s
  `issueSessionCapability` / `SessionCapabilityScope`.
- **Scoped send** — `@noisebound/sigma-execute`'s `AgentMoneyActionRequest`
  / `fromAgentMoneyAction`, including the scope check
  (`maxSpendWei`/`allowedContracts`) enforced at execution time in
  `execute.ts`.
- **Escalation confirm/deny** — `@noisebound/sigma-core`'s
  `EscalationDecision` (`allow | deny | require-disclosure |
  require-confirmation | require-secondary-confirmation`) and
  `confirmEscalation`.

It also specifically seeds examples for the known model failure mode
documented in the base-model decision doc: near-universal failure to
refuse sends to burn-address/invalid recipients absent explicit "this is a
scam" framing (now guarded in code by `sigma-execute`'s
`checkRecipientSafety`, but still worth reinforcing in the fine-tune).

## Package layout

- `src/toolSchema.ts` — model-facing tool definitions (`send_native`,
  `issue_session_key`, `evaluate_escalation_response`) and system prompt.
- `src/scenarios.ts` — hand-written scenario catalog, grouped by primitive.
- `src/example.ts` — converts one `Scenario` into a full chat-format
  training example (OpenAI/Qwen tool-calling wire format).
- `src/generate.ts` / `src/cli.ts` — expands the scenario catalog with
  seeded variation and writes a train/val JSONL split.
- `training/` — `lora_config.yaml` (Unsloth QLoRA config for
  `Qwen/Qwen3-30B-A3B`) and `train.py` (thin Unsloth SFT training script).
  Not part of this package's TS build — plain files for a separate Python
  environment.

## Usage

```bash
# Generate training/data/train.jsonl and training/data/val.jsonl
pnpm --filter @noisebound/sigma-tune generate
```

See [training/README.md](./training/README.md) for how to run the actual
QLoRA fine-tune against the generated dataset.

## Dataset format

Each JSONL line is one multi-turn training example:

```json
{
  "tools": [ /* TOOL_SCHEMAS */ ],
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "Send 0.001 ETH to 0x..." },
    {
      "role": "assistant",
      "content": null,
      "tool_calls": [
        {
          "id": "call_0",
          "type": "function",
          "function": { "name": "send_native", "arguments": "{\"recipient\":\"0x...\",\"amount\":\"0.001\",\"asset\":\"ETH\"}" }
        }
      ]
    },
    { "role": "tool", "tool_call_id": "call_0", "content": "{\"status\":\"awaiting-confirmation\", ...}" },
    { "role": "assistant", "content": "I've queued a transfer of 0.001 ETH to 0x...ad3 — please confirm to proceed." }
  ]
}
```

This is the format Qwen3's chat template (and standard SFT frameworks
like Unsloth/TRL/axolotl) expect for tool-calling supervised fine-tuning.
