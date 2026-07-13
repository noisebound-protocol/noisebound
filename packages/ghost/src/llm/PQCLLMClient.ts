import fetch from 'node-fetch';
import { DeidentificationPipeline } from '../crypto/DeidentificationPipeline.js';
import { pqcTransport } from '../crypto/PQCTransport.js';
import { COORDINATOR_PUBLIC_KEY } from '../crypto/keys.js';
import type { UserContext } from '../parser/types.js';

export interface PQCLLMConfig {
  apiKey: string;
  model?: string;
  /** Forward-compatibility slot for Phase 2 TEE proxy. Empty = direct to Anthropic. */
  proxyUrl?: string;
  maxTokens?: number;
}

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_MAX_TOKENS = 1024;
const ANTHROPIC_BASE = 'https://api.anthropic.com';

export class PQCLLMClient {
  private readonly pipeline = new DeidentificationPipeline();

  constructor(private readonly config: PQCLLMConfig) {}

  async *stream(messages: LLMMessage[], userContext: UserContext): AsyncGenerator<string, void, unknown> {
    let lastVault = {};

    const sanitizedMessages = messages.map((msg) => {
      if (msg.role === 'user') {
        const { sanitized, vault } = this.pipeline.deidentify(msg.content, userContext);
        lastVault = vault;
        return { ...msg, content: sanitized };
      }
      return msg;
    });

    const baseUrl = this.config.proxyUrl || ANTHROPIC_BASE;
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.config.model ?? DEFAULT_MODEL,
        max_tokens: this.config.maxTokens ?? DEFAULT_MAX_TOKENS,
        stream: true,
        messages: sanitizedMessages,
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
    }

    const body = response.body;
    if (!body) return;

    let buffer = '';
    for await (const raw of body) {
      buffer += Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data) as {
            type: string;
            delta?: { type: string; text?: string };
          };
          if (
            parsed.type === 'content_block_delta' &&
            parsed.delta?.type === 'text_delta' &&
            parsed.delta.text
          ) {
            yield this.pipeline.reidentify(parsed.delta.text, lastVault);
          }
        } catch {
          // skip malformed SSE lines
        }
      }
    }
  }

  async chat(messages: LLMMessage[], userContext: UserContext): Promise<string> {
    let lastVault = {};

    const sanitizedMessages = messages.map((msg) => {
      if (msg.role === 'user') {
        const { sanitized, vault } = this.pipeline.deidentify(msg.content, userContext);
        lastVault = vault;
        return { ...msg, content: sanitized };
      }
      return msg;
    });

    const baseUrl = this.config.proxyUrl || ANTHROPIC_BASE;
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.config.model ?? DEFAULT_MODEL,
        max_tokens: this.config.maxTokens ?? DEFAULT_MAX_TOKENS,
        messages: sanitizedMessages,
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { content: Array<{ type: string; text: string }> };
    const rawResponse = data.content?.[0]?.text ?? '';

    // Fire-and-forget PQC audit envelope — never blocks the response.
    // Seals the sanitized messages + raw LLM output so the coordinator can
    // verify de-identification happened before inference.
    void pqcTransport
      .seal({ sanitizedMessages, response: rawResponse, timestamp: Date.now() }, COORDINATOR_PUBLIC_KEY)
      .catch(() => {
        // audit is best-effort
      });

    return this.pipeline.reidentify(rawResponse, lastVault);
  }
}
