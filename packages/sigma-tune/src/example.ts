import { SYSTEM_PROMPT, TOOL_SCHEMAS } from './toolSchema.js';
import type { ToolSchema } from './toolSchema.js';
import type { Scenario } from './scenarios.js';

export interface ToolCallMessagePart {
  readonly id: string;
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    /** Always a JSON-serialized string (never a raw object) — the OpenAI/Qwen wire format. */
    readonly arguments: string;
  };
}

export type ChatMessage =
  | { readonly role: 'system'; readonly content: string }
  | { readonly role: 'user'; readonly content: string }
  | { readonly role: 'assistant'; readonly content: string | null; readonly tool_calls?: readonly ToolCallMessagePart[] }
  | { readonly role: 'tool'; readonly tool_call_id: string; readonly content: string };

export interface TrainingExample {
  readonly id: string;
  readonly category: Scenario['category'];
  readonly terminalOutcome: Scenario['terminalOutcome'];
  readonly tools: readonly ToolSchema[];
  readonly messages: readonly ChatMessage[];
}

/**
 * Converts one Scenario into a full chat-format training example. Tool call
 * ids are assigned in call order (call_0, call_1, ...) and threaded through
 * to the immediately following tool-result step via `tool_call_id` — a
 * scenario's steps must alternate 'assistant-tool-call' -> 'tool-result' for
 * each tool round-trip, which every builder in scenarios.ts follows.
 */
export function buildExample(scenario: Scenario): TrainingExample {
  const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];
  let pendingToolCallId: string | undefined;
  let callIndex = 0;

  for (const step of scenario.steps) {
    switch (step.role) {
      case 'user':
        messages.push({ role: 'user', content: step.content });
        break;
      case 'assistant-tool-call': {
        const id = `call_${callIndex}`;
        callIndex += 1;
        pendingToolCallId = id;
        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id,
              type: 'function',
              function: { name: step.toolCall.name, arguments: JSON.stringify(step.toolCall.arguments) },
            },
          ],
        });
        break;
      }
      case 'tool-result': {
        if (pendingToolCallId === undefined) {
          throw new Error(`buildExample(${scenario.id}): tool-result step with no preceding assistant-tool-call`);
        }
        messages.push({ role: 'tool', tool_call_id: pendingToolCallId, content: JSON.stringify(step.result) });
        pendingToolCallId = undefined;
        break;
      }
      case 'assistant-final':
        messages.push({ role: 'assistant', content: step.content });
        break;
    }
  }

  return {
    id: scenario.id,
    category: scenario.category,
    terminalOutcome: scenario.terminalOutcome,
    tools: TOOL_SCHEMAS,
    messages,
  };
}
