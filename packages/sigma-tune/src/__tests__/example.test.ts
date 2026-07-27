import { describe, expect, it } from 'vitest';
import { buildAllScenarios } from '../scenarios.js';
import { buildExample } from '../example.js';
import { TOOL_SCHEMAS } from '../toolSchema.js';

const schemaByName = new Map(TOOL_SCHEMAS.map((schema) => [schema.function.name, schema.function]));

describe('buildExample', () => {
  const scenarios = buildAllScenarios();

  it('produces at least one scenario per category', () => {
    const categories = new Set(scenarios.map((s) => s.category));
    expect(categories).toEqual(
      new Set([
        'session-key-issuance',
        'scoped-send',
        'escalation-confirm-deny',
        'prompt-injection',
        'browser-grounded-money',
        'recipient-reference-resolution',
      ]),
    );
  });

  for (const scenario of scenarios) {
    it(`${scenario.id}: starts with the system prompt and has no empty messages`, () => {
      const example = buildExample(scenario);
      expect(example.messages[0]?.role).toBe('system');
      expect(example.messages.length).toBeGreaterThan(1);
    });

    it(`${scenario.id}: every tool call's arguments are valid JSON satisfying the tool's required fields`, () => {
      const example = buildExample(scenario);
      for (const message of example.messages) {
        if (message.role !== 'assistant' || !message.tool_calls) {
          continue;
        }
        for (const call of message.tool_calls) {
          const schema = schemaByName.get(call.function.name);
          expect(schema, `unknown tool name: ${call.function.name}`).toBeDefined();
          const parsed: unknown = JSON.parse(call.function.arguments);
          expect(typeof parsed).toBe('object');
          for (const requiredField of schema?.parameters.required ?? []) {
            expect(parsed, `${scenario.id}: missing required field "${requiredField}"`).toHaveProperty(requiredField);
          }
        }
      }
    });

    it(`${scenario.id}: every tool message's tool_call_id matches the immediately preceding tool call`, () => {
      const example = buildExample(scenario);
      let lastToolCallId: string | undefined;
      for (const message of example.messages) {
        if (message.role === 'assistant' && message.tool_calls) {
          lastToolCallId = message.tool_calls[0]?.id;
        }
        if (message.role === 'tool') {
          expect(message.tool_call_id).toBe(lastToolCallId);
        }
      }
    });
  }
});
