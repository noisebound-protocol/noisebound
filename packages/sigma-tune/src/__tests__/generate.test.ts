import { describe, expect, it } from 'vitest';
import { generateDataset, toJsonl } from '../generate.js';
import type { TrainingExample } from '../example.js';

const FORBIDDEN_SUCCESS_PHRASES = ['sent successfully', "i've sent", 'transaction confirmed', 'done, sent'];
const TX_HASH_PATTERN = /0x[0-9a-f]{64}/gi;

function toolResultPayloads(example: TrainingExample): Record<string, unknown>[] {
  return example.messages
    .filter((message): message is Extract<TrainingExample['messages'][number], { role: 'tool' }> => message.role === 'tool')
    .map((message) => JSON.parse(message.content) as Record<string, unknown>);
}

function assistantTexts(example: TrainingExample): string[] {
  return example.messages
    .filter((message): message is Extract<TrainingExample['messages'][number], { role: 'assistant' }> => message.role === 'assistant')
    .map((message) => message.content)
    .filter((content): content is string => content !== null);
}

describe('generateDataset', () => {
  const dataset = generateDataset();
  const all = [...dataset.train, ...dataset.val];

  it('produces a non-trivial dataset with no overlap between train and val', () => {
    expect(dataset.train.length).toBeGreaterThan(0);
    expect(dataset.val.length).toBeGreaterThan(0);
    const trainIds = new Set(dataset.train.map((e) => e.id));
    const valIds = new Set(dataset.val.map((e) => e.id));
    for (const id of valIds) {
      expect(trainIds.has(id)).toBe(false);
    }
  });

  it('is reproducible given the same seed', () => {
    const again = generateDataset();
    expect(again.train.map((e) => e.id)).toEqual(dataset.train.map((e) => e.id));
    expect(again.val.map((e) => e.id)).toEqual(dataset.val.map((e) => e.id));
  });

  it('covers every category in both the train and val split', () => {
    const categories = ['session-key-issuance', 'scoped-send', 'escalation-confirm-deny', 'prompt-injection'];
    for (const split of [dataset.train, dataset.val]) {
      const present = new Set(split.map((e) => e.category));
      for (const category of categories) {
        expect(present.has(category as never), `missing category ${category}`).toBe(true);
      }
    }
  });

  it('never emits an executed/allow tool-result for a denied or refused scenario', () => {
    for (const example of all) {
      if (example.terminalOutcome !== 'denied' && example.terminalOutcome !== 'refuse') {
        continue;
      }
      const statuses = toolResultPayloads(example).map((r) => r.status);
      expect(statuses).not.toContain('executed');
      expect(statuses).not.toContain('allow');
    }
  });

  it('never claims success or fabricates a tx hash before an executed tool-result is seen', () => {
    for (const example of all) {
      let executedTxHash: string | undefined;
      let sawExecuted = false;

      for (const message of example.messages) {
        if (message.role === 'tool') {
          const payload = JSON.parse(message.content) as Record<string, unknown>;
          if (payload.status === 'executed') {
            sawExecuted = true;
            const result = payload.result as { txHash?: string } | undefined;
            executedTxHash = result?.txHash;
          }
        }

        if (message.role === 'assistant' && typeof message.content === 'string') {
          const lower = message.content.toLowerCase();
          for (const phrase of FORBIDDEN_SUCCESS_PHRASES) {
            if (!sawExecuted) {
              expect(lower, `${example.id}: claimed success before execution: "${message.content}"`).not.toContain(phrase);
            }
          }

          const mentionedHashes = message.content.match(TX_HASH_PATTERN) ?? [];
          for (const hash of mentionedHashes) {
            expect(hash.toLowerCase(), `${example.id}: mentioned a tx hash that was never returned by a tool result`).toBe(
              executedTxHash?.toLowerCase(),
            );
          }
        }
      }
    }
  });

  it('reports the exact tx hash from the tool result once a send executes', () => {
    for (const example of all) {
      if (example.terminalOutcome !== 'executed') {
        continue;
      }
      const executed = toolResultPayloads(example).find((r) => r.status === 'executed');
      const result = executed?.result as { txHash?: string } | undefined;
      expect(result?.txHash).toBeDefined();
      const finalText = assistantTexts(example).at(-1) ?? '';
      expect(finalText).toContain(result?.txHash);
    }
  });

  it('relays the failure reason (never success language) when execution fails on scope', () => {
    for (const example of all) {
      if (example.terminalOutcome !== 'execution-failed') {
        continue;
      }
      const finalText = (assistantTexts(example).at(-1) ?? '').toLowerCase();
      for (const phrase of FORBIDDEN_SUCCESS_PHRASES) {
        expect(finalText).not.toContain(phrase);
      }
      expect(finalText).not.toMatch(TX_HASH_PATTERN);
    }
  });

  it('serializes to valid, parseable JSONL', () => {
    const jsonl = toJsonl(all);
    const lines = jsonl.trim().split('\n');
    expect(lines).toHaveLength(all.length);
    for (const line of lines) {
      const parsed = JSON.parse(line) as { tools?: unknown; messages?: unknown };
      expect(parsed.tools).toBeDefined();
      expect(parsed.messages).toBeDefined();
    }
  });
});
