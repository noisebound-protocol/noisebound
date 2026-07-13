import type { GhostAction, ParsedIntent, ParsedIntentParams, UserContext } from './types.js';

// Shared interface satisfied by both DistilBertClassifier and EmbeddingClassifier.
interface IntentClassifier {
  classifyAsync(text: string): Promise<{ action: GhostAction; confidence: number }>;
}

const KNOWN_TOKENS = [
  'USDC', 'USDT', 'DAI', 'ETH', 'WETH', 'WBTC', 'CBBTC', 'CBETH', 'OCT', 'AERO', 'WELL',
];

const KNOWN_PROTOCOLS = ['aave', 'uniswap', 'aerodrome'];

interface RuleMatch {
  action: GhostAction;
  requiresReasoning: boolean;
}

// Actions that require DeFiReasoner — keeps the lookup in one place.
const REQUIRES_REASONING: ReadonlySet<GhostAction> = new Set([
  'borrow', 'provide_liquidity', 'remove_liquidity', 'bridge', 'complex',
]);

export class IntentParser {
  private classifier: IntentClassifier | null = null;

  /**
   * Load the intent classifier. Tries DistilBertClassifier (ONNX, ~5-15 ms/inference)
   * first; gracefully falls back to EmbeddingClassifier (MiniLM k-NN) if the ONNX
   * model files aren't present (e.g. dev environments without a trained model).
   * Call once before using parseAsync(). Safe to skip — parse() stays sync.
   */
  async initClassifier(): Promise<void> {
    try {
      const { DistilBertClassifier } = await import('./DistilBertClassifier.js');
      const bert = new DistilBertClassifier();
      await bert.init();
      this.classifier = bert;
    } catch (bertErr) {
      console.warn(
        '[IntentParser] DistilBertClassifier unavailable, falling back to EmbeddingClassifier:',
        bertErr instanceof Error ? bertErr.message : bertErr,
      );
      const { EmbeddingClassifier } = await import('./EmbeddingClassifier.js');
      const emb = new EmbeddingClassifier();
      await emb.init();
      this.classifier = emb;
    }
  }

  /**
   * Embedding-primary intent parse.
   * Short inputs (≤ 2 words) take the fast regex path first; longer inputs go
   * through the MiniLM classifier, falling back to regex if the classifier
   * is not yet initialized.
   */
  async parseAsync(input: string, context?: UserContext): Promise<ParsedIntent> {
    const trimmed = input.trim();

    if (trimmed.length === 0) {
      return this.buildClarify(input, 'what you would like me to do');
    }

    // Fast regex override for obvious single/two-word commands ("swap", "stake ETH", …)
    const wordCount = trimmed.split(/\s+/).length;
    if (wordCount <= 2) {
      const regexMatch = this.matchRules(trimmed);
      if (regexMatch) {
        return this.buildFromMatch(input, trimmed, regexMatch);
      }
    }

    // Embedding-classifier primary path
    if (this.classifier) {
      const { action, confidence: embConfidence } = await this.classifier.classifyAsync(trimmed);
      const params = this.extractParams(trimmed, action);
      const confidence = this.blendConfidence(embConfidence, action, params, trimmed);
      const intent: ParsedIntent = {
        action,
        confidence,
        params,
        requiresReasoning: REQUIRES_REASONING.has(action),
        raw: input,
        ghostResponse: '',
      };
      intent.ghostResponse = this.buildGhostResponse(intent);
      return intent;
    }

    // Classifier not initialized — fall through to regex
    return this.parse(input, context);
  }

  parse(input: string, _context?: UserContext): ParsedIntent {
    const raw = input;
    const trimmed = input.trim();

    if (trimmed.length === 0) {
      return this.buildClarify(raw, 'what you would like me to do');
    }

    const match = this.matchRules(trimmed);
    if (!match) {
      return this.buildClarify(raw, 'what action you would like Ghost to take');
    }

    const params = this.extractParams(trimmed, match.action);
    const confidence = this.scoreConfidence(match.action, params, trimmed);

    const intent: ParsedIntent = {
      action: match.action,
      confidence,
      params,
      requiresReasoning: match.requiresReasoning,
      raw,
      ghostResponse: '',
    };
    intent.ghostResponse = this.buildGhostResponse(intent);
    return intent;
  }

  private matchRules(input: string): RuleMatch | null {
    const t = input.toLowerCase();

    const hasProtocol = KNOWN_PROTOCOLS.some(p => t.includes(p));
    const hasConstraint = /\bno more than\b|\bat least\b|\bonly if\b|\bunless\b|\bas long as\b/.test(t);

    if (/\b(provide|add)\b[\s\w]*\bliquidity\b|\blp\b/.test(t)) {
      return { action: 'provide_liquidity', requiresReasoning: true };
    }
    if (/\b(remove|withdraw|pull)\b[\s\w]*\bliquidity\b/.test(t)) {
      return { action: 'remove_liquidity', requiresReasoning: true };
    }
    if (/\bbridge\b|cross[\s-]?chain/.test(t)) {
      return { action: 'bridge', requiresReasoning: true };
    }
    if (/\b(repay|pay back|payoff|pay off)\b/.test(t)) {
      return { action: 'repay', requiresReasoning: false };
    }
    if (/\b(borrow|loan|leverage)\b/.test(t) || /\bcollateral\b/.test(t)) {
      return { action: 'borrow', requiresReasoning: true };
    }
    if (hasProtocol && hasConstraint) {
      return { action: 'complex', requiresReasoning: true };
    }
    if (/\b(swap|exchange|convert)\b/.test(t)) {
      return { action: 'swap', requiresReasoning: false };
    }
    if (/\b(send|transfer|pay)\b/.test(t)) {
      return { action: 'send', requiresReasoning: false };
    }
    if (/\b(stake|staking|unstake)\b/.test(t)) {
      return { action: 'stake', requiresReasoning: false };
    }
    if (/\b(earn|yield|apy|interest)\b/.test(t)) {
      return { action: 'earn', requiresReasoning: false };
    }
    if (/\bapprove\b/.test(t)) {
      return { action: 'approve', requiresReasoning: false };
    }
    if (/\bbalance\b|\bportfolio\b|how much (do i|have i|is in)/.test(t)) {
      return { action: 'query', requiresReasoning: false };
    }
    if (/\bhistory\b|\btransactions?\b/.test(t)) {
      return { action: 'query', requiresReasoning: false };
    }
    if (/\bprice\b|\brate\b|\bapy\b/.test(t)) {
      return { action: 'query', requiresReasoning: false };
    }
    if (hasProtocol) {
      return { action: 'complex', requiresReasoning: true };
    }
    return null;
  }

  private extractParams(input: string, action: GhostAction): ParsedIntentParams {
    const params: ParsedIntentParams = {};
    const t = input.toLowerCase();

    // ─── Amount ───────────────────────────────────────────────────────────
    const pctMatch = input.match(/(\d+(?:\.\d+)?)\s*%/);
    if (pctMatch) {
      params.amount = pctMatch[1];
      params.amountIsPercent = true;
    } else if (/\ball\b/.test(t)) {
      params.amount = '100';
      params.amountIsPercent = true;
    } else if (/\bhalf\b/.test(t)) {
      params.amount = '50';
      params.amountIsPercent = true;
    } else {
      const numMatch = input.match(/(\d+(?:\.\d+)?)/);
      if (numMatch) params.amount = numMatch[1];
    }

    // ─── Tokens ───────────────────────────────────────────────────────────
    const tokenRegex = new RegExp(`\\b(${KNOWN_TOKENS.join('|')})\\b`, 'gi');
    const tokenMatches = Array.from(input.matchAll(tokenRegex)).map(m => m[1].toUpperCase());
    const uniqueTokens = [...new Set(tokenMatches)];

    if (uniqueTokens.length > 0) {
      const directional = input.match(
        /\b(?:swap|exchange|convert|bridge)\b[\s\d.%]*\s*(\w+)\s+(?:for|to|into)\s+(\w+)/i,
      );
      if (directional && KNOWN_TOKENS.includes(directional[1].toUpperCase()) && KNOWN_TOKENS.includes(directional[2].toUpperCase())) {
        params.fromToken = directional[1].toUpperCase();
        params.toToken = directional[2].toUpperCase();
      } else if (action === 'send') {
        params.fromToken = uniqueTokens[0];
      } else if (uniqueTokens.length >= 2) {
        params.fromToken = uniqueTokens[0];
        params.toToken = uniqueTokens[1];
      } else {
        params.fromToken = uniqueTokens[0];
      }
    }

    // ─── Recipient address ───────────────────────────────────────────────
    const addrMatch = input.match(/0x[a-fA-F0-9]{40}/);
    if (addrMatch) params.recipient = addrMatch[0];
    else {
      const nameMatch = input.match(/\bto\s+([A-Za-z][\w.]*)\b(?!\s*(?:for|to|into))/);
      if (action === 'send' && nameMatch && !KNOWN_TOKENS.includes(nameMatch[1].toUpperCase())) {
        params.recipient = nameMatch[1];
      }
    }

    // ─── Protocol ─────────────────────────────────────────────────────────
    const protocol = KNOWN_PROTOCOLS.find(p => t.includes(p));
    if (protocol) params.protocol = protocol;

    // ─── Constraint ───────────────────────────────────────────────────────
    const constraintMatch = input.match(
      /\b((?:no more than|at least|only if|unless|as long as)\b[^,.;]*)/i,
    );
    if (constraintMatch) params.constraint = constraintMatch[1].trim();

    // ─── Timeframe ────────────────────────────────────────────────────────
    const timeframeMatch = input.match(
      /\b(by end of day|today|tomorrow|this week|weekly|daily|monthly|right now|asap)\b/i,
    );
    if (timeframeMatch) params.timeframe = timeframeMatch[1].toLowerCase();

    // ─── Slippage ─────────────────────────────────────────────────────────
    const slippageMatch = input.match(/slippage[^\d%]*(\d+(?:\.\d+)?)\s*%/i);
    if (slippageMatch) params.slippage = parseFloat(slippageMatch[1]) / 100;

    // ─── Max gas ──────────────────────────────────────────────────────────
    const gasMatch = input.match(/gas[^$\d]*\$?(\d+(?:\.\d+)?)/i);
    if (gasMatch) params.maxGas = gasMatch[1];

    // ─── Query type ───────────────────────────────────────────────────────
    if (action === 'query') {
      if (/\bbalance\b|\bportfolio\b|how much/.test(t)) params.queryType = 'balance';
      else if (/\bhistory\b|\btransactions?\b/.test(t)) params.queryType = 'history';
      else if (/\bprice\b|\brate\b|\bapy\b/.test(t)) params.queryType = 'price';
    }

    return params;
  }

  private scoreConfidence(action: GhostAction, params: ParsedIntentParams, input: string): number {
    let score = 0.6;
    if (params.amount) score += 0.1;
    if (params.fromToken || params.toToken) score += 0.1;
    if (params.protocol) score += 0.1;
    if (action === 'complex') score -= 0.1;
    if (input.split(/\s+/).length <= 2) score -= 0.1;
    return Math.max(0.2, Math.min(0.97, score));
  }

  private buildGhostResponse(intent: ParsedIntent): string {
    const { action, params } = intent;
    switch (action) {
      case 'swap':
        return `Understood, Sovereign. Preparing to swap ${params.amount ?? 'the requested amount of'} ${params.fromToken ?? 'tokens'} to ${params.toToken ?? 'your target asset'}.`;
      case 'send':
        return `Understood, Sovereign. Sending ${params.amount ?? 'the requested amount of'} ${params.fromToken ?? 'tokens'} to ${params.recipient ?? 'the specified recipient'}.`;
      case 'earn':
        return `Understood, Sovereign. Scanning the market for the best yield on ${params.fromToken ?? 'your assets'}.`;
      case 'stake':
        return `Understood, Sovereign. Preparing to stake ${params.amount ?? 'the requested amount of'} ${params.fromToken ?? 'tokens'}.`;
      case 'borrow':
        return `Understood, Sovereign. Analyzing loan parameters for your position.`;
      case 'repay':
        return `Understood, Sovereign. Preparing to repay ${params.amount ?? 'the requested amount of'} ${params.fromToken ?? 'your debt'}.`;
      case 'provide_liquidity':
        return `Understood, Sovereign. Evaluating liquidity provision for ${params.fromToken ?? 'the requested pair'}.`;
      case 'remove_liquidity':
        return `Understood, Sovereign. Preparing to withdraw your liquidity position.`;
      case 'bridge':
        return `Understood, Sovereign. Planning a cross-chain bridge for ${params.fromToken ?? 'your assets'}.`;
      case 'approve':
        return `Understood, Sovereign. Preparing the approval transaction.`;
      case 'query':
        return `Understood, Sovereign. Pulling your ${params.queryType ?? 'requested'} information.`;
      case 'complex':
        return `Understood, Sovereign. Reasoning through your request...`;
      case 'clarify':
        return intent.ghostResponse;
      default:
        return `Understood, Sovereign. Processing your request.`;
    }
  }

  private buildFromMatch(raw: string, trimmed: string, match: RuleMatch): ParsedIntent {
    const params = this.extractParams(trimmed, match.action);
    const confidence = this.scoreConfidence(match.action, params, trimmed);
    const intent: ParsedIntent = {
      action: match.action,
      confidence,
      params,
      requiresReasoning: match.requiresReasoning,
      raw,
      ghostResponse: '',
    };
    intent.ghostResponse = this.buildGhostResponse(intent);
    return intent;
  }

  // Blends embedding cosine similarity with slot-fill signals for a final score.
  private blendConfidence(
    embSim: number,
    action: GhostAction,
    params: ParsedIntentParams,
    input: string,
  ): number {
    let bonus = 0;
    if (params.amount) bonus += 0.05;
    if (params.fromToken || params.toToken) bonus += 0.05;
    if (params.protocol) bonus += 0.05;
    if (action === 'complex') bonus -= 0.05;
    return Math.max(0.2, Math.min(0.97, embSim + bonus));
  }

  private buildClarify(raw: string, unclearPart: string): ParsedIntent {
    return {
      action: 'clarify',
      confidence: 0.3,
      params: {},
      requiresReasoning: false,
      raw,
      ghostResponse: `Sovereign, could you clarify ${unclearPart}?`,
    };
  }
}
