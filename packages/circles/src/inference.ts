/**
 * VeilLM inference client.
 *
 * CURRENT STATUS (honest):
 *   VeilLM is distributed LLM inference running inside Octra Circles —
 *   agent queries processed privately across nodes using FHE so no single
 *   node sees the query plaintext.
 *   The distributed inference network is not yet live.
 *
 *   This module implements the correct interface with:
 *     - A deterministic regex mock (no sessionConfig)
 *     - A FHE-routed path via CircleSession (sessionConfig provided)
 *
 *   Both paths return identical InferenceResult shapes so downstream code
 *   (AgentCircle, tests) works against either implementation today.
 *
 *   When VeilLM inference goes live, the sessionConfig path will already
 *   route through real Circle RPC — only the mock inside CircleSession
 *   needs to be replaced with an actual Octra program.call.
 */

import { CircleSession } from './session.js';
import type { DeFiContext, InferenceResult, ParsedIntent, SessionConfig } from './types.js';

const MOCK_MODEL_VERSION = 'veil-lm-mock-0.1.0';

export class VeilLMClient {
  constructor(
    private readonly circleAddress?: string,
    private readonly sessionConfig?: SessionConfig,
  ) {}

  /**
   * Sends a natural language prompt to VeilLM for inference.
   *
   * When sessionConfig is provided: routes through private_predict inside a
   * sealed CircleSession — the prompt is FHE-encrypted before entering the
   * Circle and the result is decrypted on return. No plaintext leaves the
   * encrypted boundary.
   *
   * When sessionConfig is absent: falls back to the local regex mock so
   * downstream code and tests work without a keypair or Octra connection.
   *
   * TODO (FHE path): when VeilLM inference is live, the CircleSession's
   * private_predict body is the only thing that changes — this method stays.
   */
  async query(prompt: string, context: DeFiContext): Promise<InferenceResult> {
    if (this.sessionConfig) {
      const session = new CircleSession(this.sessionConfig);
      await session.create();
      try {
        const encryptedQuery = await session.encryptQuery(prompt, context);
        const encryptedResult = await session.private_predict(encryptedQuery);
        return await session.decryptResult(encryptedResult);
      } finally {
        await session.teardown();
      }
    }

    // Local mock path (no session configured)
    const intent = await this.parseIntent(prompt);
    const rawResponse = buildRawResponse(intent, context);
    return {
      intent,
      confidence: scoreConfidence(prompt, intent),
      rawResponse,
      modelVersion: MOCK_MODEL_VERSION,
    };
  }

  /**
   * Parses a natural language DeFi instruction into a structured ParsedIntent.
   *
   * Mock implementation covers common DeFi patterns via regex.
   * Real implementation would route through a VeilLM Circle for private
   * LLM inference so no agent intent leaks to any single node.
   *
   * TODO: wire into VeilLM Circle when distributed inference is available.
   */
  async parseIntent(instruction: string): Promise<ParsedIntent> {
    return parseIntentMock(instruction);
  }

  /**
   * Submits a pre-encrypted query to a sealed Circle for FHE inference.
   *
   * Creates a CircleSession internally using the client's sessionConfig.
   * Caller is responsible for encrypting the query (e.g. via CircleSession
   * directly) before passing it here.
   *
   * Throws if no sessionConfig was provided at construction.
   *
   * TODO: this method routes to real Octra program.call automatically once
   * CircleSession.private_predict is wired to the live Octra SDK.
   */
  async private_predict(encryptedQuery: Uint8Array): Promise<Uint8Array> {
    if (!this.sessionConfig) {
      throw new Error(
        'VeilLMClient.private_predict: sessionConfig required — ' +
          'construct VeilLMClient with a SessionConfig to use the FHE path',
      );
    }
    const session = new CircleSession(this.sessionConfig);
    await session.create();
    try {
      return await session.private_predict(encryptedQuery);
    } finally {
      await session.teardown();
    }
  }
}

// ─── Mock implementation ─────────────────────────────────────────────────────

function parseIntentMock(instruction: string): ParsedIntent {
  const text = instruction.toLowerCase().trim();

  // swap / exchange
  const swapMatch =
    text.match(/swap\s+([\d.]+\s+)?(\w+)\s+(?:for|to)\s+(\w+)/i) ??
    text.match(/exchange\s+([\d.]+\s+)?(\w+)\s+(?:for|to)\s+(\w+)/i);
  if (swapMatch) {
    return {
      action: 'swap',
      fromToken: swapMatch[2].toUpperCase(),
      toToken: swapMatch[3].toUpperCase(),
      amount: swapMatch[1]?.trim(),
      protocol: extractProtocol(text),
      slippageTolerance: extractSlippage(text) ?? 0.005,
      urgency: extractUrgency(text),
    };
  }

  // bridge
  const bridgeMatch = text.match(/bridge\s+([\d.]+\s+)?(\w+)\s+(?:to|from)\s+(\w+)/i);
  if (bridgeMatch) {
    return {
      action: 'bridge',
      fromToken: bridgeMatch[2].toUpperCase(),
      toToken: bridgeMatch[3].toUpperCase(),
      amount: bridgeMatch[1]?.trim(),
      protocol: extractProtocol(text),
      urgency: extractUrgency(text),
    };
  }

  // stake
  const stakeMatch = text.match(/stake\s+([\d.]+\s+)?(\w+)/i);
  if (stakeMatch) {
    return {
      action: 'stake',
      fromToken: stakeMatch[2].toUpperCase(),
      amount: stakeMatch[1]?.trim(),
      protocol: extractProtocol(text),
      urgency: extractUrgency(text),
    };
  }

  // borrow
  const borrowMatch = text.match(/borrow\s+([\d.]+\s+)?(\w+)/i);
  if (borrowMatch) {
    return {
      action: 'borrow',
      toToken: borrowMatch[2].toUpperCase(),
      amount: borrowMatch[1]?.trim(),
      protocol: extractProtocol(text),
      urgency: extractUrgency(text),
    };
  }

  // lend / supply / deposit
  const lendMatch = text.match(/(?:lend|supply|deposit)\s+([\d.]+\s+)?(\w+)/i);
  if (lendMatch) {
    return {
      action: 'lend',
      fromToken: lendMatch[2].toUpperCase(),
      amount: lendMatch[1]?.trim(),
      protocol: extractProtocol(text),
      urgency: extractUrgency(text),
    };
  }

  return { action: 'unknown', urgency: 'low' };
}

function extractProtocol(text: string): string | undefined {
  const protocols = ['uniswap', 'aave', 'curve', 'compound', 'lido', 'stargate', 'hop', 'across'];
  return protocols.find(p => text.includes(p));
}

function extractSlippage(text: string): number | undefined {
  const m = text.match(/(\d+(?:\.\d+)?)\s*%\s*slippage/i);
  return m ? parseFloat(m[1]) / 100 : undefined;
}

function extractUrgency(text: string): 'low' | 'medium' | 'high' {
  if (/urgent|asap|immediately|now|fast/i.test(text)) return 'high';
  if (/soon|quick/i.test(text)) return 'medium';
  return 'low';
}

function scoreConfidence(instruction: string, intent: ParsedIntent): number {
  void instruction;
  if (intent.action === 'unknown') return 0.2;
  const hasAmount = intent.amount !== undefined;
  const hasProtocol = intent.protocol !== undefined;
  const hasTokens = intent.fromToken !== undefined || intent.toToken !== undefined;
  return 0.55 + (hasAmount ? 0.1 : 0) + (hasProtocol ? 0.2 : 0) + (hasTokens ? 0.1 : 0);
}

function buildRawResponse(intent: ParsedIntent, context: DeFiContext): string {
  return JSON.stringify({
    model: MOCK_MODEL_VERSION,
    parsed: intent,
    context_protocols: context.availableProtocols,
    note: 'VeilLM mock — replace with Circle inference when distributed network is live',
  });
}
