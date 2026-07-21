import { SYSTEM_PROMPT, TOOL_SCHEMAS } from './toolSchema.js';
import type { Scenario } from './scenarios.js';

export interface RunnerConfig {
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey?: string;
  readonly runsPerScenario: number;
}

const DEFAULT_BASE_URL = 'http://localhost:11434/v1';
const DEFAULT_MODEL = 'qwen3:30b-a3b';
const DEFAULT_RUNS = 3;

export function loadRunnerConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RunnerConfig {
  const runsRaw = env.MODEL_EVAL_RUNS;
  const runsPerScenario = runsRaw ? Number.parseInt(runsRaw, 10) : DEFAULT_RUNS;
  if (!Number.isInteger(runsPerScenario) || runsPerScenario < 1) {
    throw new Error(`MODEL_EVAL_RUNS must be a positive integer, got: ${runsRaw}`);
  }

  const apiKey = env.MODEL_EVAL_API_KEY?.trim() || undefined;

  return {
    baseUrl: env.MODEL_EVAL_BASE_URL?.trim() || DEFAULT_BASE_URL,
    model: env.MODEL_EVAL_MODEL?.trim() || DEFAULT_MODEL,
    runsPerScenario,
    ...(apiKey !== undefined ? { apiKey } : {}),
  };
}

/** Thrown when the configured chat-completions endpoint cannot be reached at all. */
export class EndpointUnreachableError extends Error {
  constructor(baseUrl: string, cause: unknown) {
    super(
      `Could not reach the model endpoint at ${baseUrl}.\n` +
        `If you're evaluating locally with Ollama:\n` +
        `  1. Start Ollama (it serves an OpenAI-compatible API on :11434 by default)\n` +
        `  2. Pull the model: ollama pull qwen3:30b-a3b\n` +
        `  3. Re-run this eval, or set MODEL_EVAL_BASE_URL / MODEL_EVAL_MODEL to point elsewhere.\n` +
        `Underlying error: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'EndpointUnreachableError';
  }
}

/** Thrown when the endpoint responds but with a non-2xx status. */
export class EndpointRequestError extends Error {
  constructor(status: number, statusText: string, body: string) {
    super(`Model endpoint returned ${status} ${statusText}: ${body}`);
    this.name = 'EndpointRequestError';
  }
}

export interface ModelToolCall {
  readonly id: string;
  readonly name: string;
  /** Parsed JSON arguments; undefined if the model emitted invalid JSON. */
  readonly arguments: Record<string, unknown> | undefined;
  readonly rawArguments: string;
}

/**
 * The complete raw assistant message and finish reason from the API response, kept
 * verbatim (content, tool_calls, and any reasoning/thinking fields the API returns) so
 * that a "no tool call" result can be diagnosed after the fact: did the model really
 * produce nothing, or did it produce something the parser above didn't recognize?
 */
export interface RawModelResponse {
  readonly message: Record<string, unknown> | undefined;
  readonly finishReason: string | null | undefined;
}

export interface ModelRunResult {
  readonly scenarioId: string;
  readonly runIndex: number;
  readonly content: string | null;
  readonly toolCalls: readonly ModelToolCall[];
  readonly rawResponse: RawModelResponse;
}

interface RawToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

interface RawChatCompletionResponse {
  readonly choices?: ReadonlyArray<{
    readonly message?: Record<string, unknown> & {
      readonly content?: string | null;
      readonly tool_calls?: readonly RawToolCall[];
    };
    readonly finish_reason?: string | null;
  }>;
}

function parseToolCalls(raw: readonly RawToolCall[] | undefined): ModelToolCall[] {
  if (!raw) return [];
  return raw.map((call) => {
    let parsedArguments: Record<string, unknown> | undefined;
    try {
      const parsed: unknown = JSON.parse(call.function.arguments);
      parsedArguments = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
    } catch {
      parsedArguments = undefined;
    }
    return {
      id: call.id,
      name: call.function.name,
      arguments: parsedArguments,
      rawArguments: call.function.arguments,
    };
  });
}

async function callChatCompletions(config: RunnerConfig, userMessage: string): Promise<RawChatCompletionResponse> {
  const url = new URL('chat/completions', config.baseUrl.endsWith('/') ? config.baseUrl : `${config.baseUrl}/`);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  const body = {
    model: config.model,
    temperature: 0,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    tools: TOOL_SCHEMAS,
    tool_choice: 'auto',
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new EndpointUnreachableError(config.baseUrl, cause);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new EndpointRequestError(response.status, response.statusText, text);
  }

  return (await response.json()) as RawChatCompletionResponse;
}

/** Runs a single scenario config.runsPerScenario times against the configured endpoint. */
export async function runScenario(config: RunnerConfig, scenario: Scenario): Promise<ModelRunResult[]> {
  const results: ModelRunResult[] = [];
  for (let runIndex = 0; runIndex < config.runsPerScenario; runIndex++) {
    const response = await callChatCompletions(config, scenario.userMessage);
    const choice = response.choices?.[0];
    const message = choice?.message;
    results.push({
      scenarioId: scenario.id,
      runIndex,
      content: message?.content ?? null,
      toolCalls: parseToolCalls(message?.tool_calls),
      rawResponse: {
        message,
        finishReason: choice?.finish_reason,
      },
    });
  }
  return results;
}

export async function runAllScenarios(
  config: RunnerConfig,
  scenarios: readonly Scenario[],
): Promise<ModelRunResult[]> {
  const results: ModelRunResult[] = [];
  for (const scenario of scenarios) {
    results.push(...(await runScenario(config, scenario)));
  }
  return results;
}
