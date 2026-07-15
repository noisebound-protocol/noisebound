import fetch6 from 'node-fetch';
import { ethers } from 'ethers';
import { generatePQCKeypair, encapsulateKey, decapsulateKey, signTransaction } from '@noisebound/pqc-wallet';
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'crypto';
import { CircleSession, fhe_load_pk, fhe_scale, fhe_add } from '@noisebound/circles';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa';
import { sha256 } from '@noble/hashes/sha2';
import { createPublicClient, http, erc20Abi, formatUnits, formatEther } from 'viem';
import { base } from 'viem/chains';

// src/Ghost.ts

// src/parser/IntentParser.ts
var KNOWN_TOKENS = [
  "USDC",
  "USDT",
  "DAI",
  "ETH",
  "WETH",
  "WBTC",
  "CBBTC",
  "CBETH",
  "OCT",
  "AERO",
  "WELL"
];
var KNOWN_PROTOCOLS = ["aave", "uniswap", "aerodrome"];
var REQUIRES_REASONING = /* @__PURE__ */ new Set([
  "borrow",
  "provide_liquidity",
  "remove_liquidity",
  "bridge",
  "complex"
]);
var IntentParser = class {
  classifier = null;
  /**
   * Load the intent classifier. Tries DistilBertClassifier (ONNX, ~5-15 ms/inference)
   * first; gracefully falls back to EmbeddingClassifier (MiniLM k-NN) if the ONNX
   * model files aren't present (e.g. dev environments without a trained model).
   * Call once before using parseAsync(). Safe to skip — parse() stays sync.
   */
  async initClassifier() {
    try {
      const { DistilBertClassifier } = await import('./DistilBertClassifier-OFXDEU64.js');
      const bert = new DistilBertClassifier();
      await bert.init();
      this.classifier = bert;
    } catch (bertErr) {
      console.warn(
        "[IntentParser] DistilBertClassifier unavailable, falling back to EmbeddingClassifier:",
        bertErr instanceof Error ? bertErr.message : bertErr
      );
      const { EmbeddingClassifier } = await import('./EmbeddingClassifier-PUA4GXHD.js');
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
  async parseAsync(input, context) {
    const trimmed = input.trim();
    if (trimmed.length === 0) {
      return this.buildClarify(input, "what you would like me to do");
    }
    const wordCount = trimmed.split(/\s+/).length;
    if (wordCount <= 2) {
      const regexMatch = this.matchRules(trimmed);
      if (regexMatch) {
        return this.buildFromMatch(input, trimmed, regexMatch);
      }
    }
    if (this.classifier) {
      const { action, confidence: embConfidence } = await this.classifier.classifyAsync(trimmed);
      const params = this.extractParams(trimmed, action);
      const confidence = this.blendConfidence(embConfidence, action, params, trimmed);
      const intent = {
        action,
        confidence,
        params,
        requiresReasoning: REQUIRES_REASONING.has(action),
        raw: input,
        ghostResponse: ""
      };
      intent.ghostResponse = this.buildGhostResponse(intent);
      return intent;
    }
    return this.parse(input, context);
  }
  parse(input, _context) {
    const raw = input;
    const trimmed = input.trim();
    if (trimmed.length === 0) {
      return this.buildClarify(raw, "what you would like me to do");
    }
    const match = this.matchRules(trimmed);
    if (!match) {
      return this.buildClarify(raw, "what action you would like Ghost to take");
    }
    const params = this.extractParams(trimmed, match.action);
    const confidence = this.scoreConfidence(match.action, params, trimmed);
    const intent = {
      action: match.action,
      confidence,
      params,
      requiresReasoning: match.requiresReasoning,
      raw,
      ghostResponse: ""
    };
    intent.ghostResponse = this.buildGhostResponse(intent);
    return intent;
  }
  matchRules(input) {
    const t = input.toLowerCase();
    const hasProtocol = KNOWN_PROTOCOLS.some((p) => t.includes(p));
    const hasConstraint = /\bno more than\b|\bat least\b|\bonly if\b|\bunless\b|\bas long as\b/.test(t);
    if (/\b(provide|add)\b[\s\w]*\bliquidity\b|\blp\b/.test(t)) {
      return { action: "provide_liquidity", requiresReasoning: true };
    }
    if (/\b(remove|withdraw|pull)\b[\s\w]*\bliquidity\b/.test(t)) {
      return { action: "remove_liquidity", requiresReasoning: true };
    }
    if (/\bbridge\b|cross[\s-]?chain/.test(t)) {
      return { action: "bridge", requiresReasoning: true };
    }
    if (/\b(repay|pay back|payoff|pay off)\b/.test(t)) {
      return { action: "repay", requiresReasoning: false };
    }
    if (/\b(borrow|loan|leverage)\b/.test(t) || /\bcollateral\b/.test(t)) {
      return { action: "borrow", requiresReasoning: true };
    }
    if (hasProtocol && hasConstraint) {
      return { action: "complex", requiresReasoning: true };
    }
    if (/\b(swap|exchange|convert)\b/.test(t)) {
      return { action: "swap", requiresReasoning: false };
    }
    if (/\b(send|transfer|pay)\b/.test(t)) {
      return { action: "send", requiresReasoning: false };
    }
    if (/\b(stake|staking|unstake)\b/.test(t)) {
      return { action: "stake", requiresReasoning: false };
    }
    if (/\b(earn|yield|apy|interest)\b/.test(t)) {
      return { action: "earn", requiresReasoning: false };
    }
    if (/\bapprove\b/.test(t)) {
      return { action: "approve", requiresReasoning: false };
    }
    if (/\bbalance\b|\bportfolio\b|how much (do i|have i|is in)/.test(t)) {
      return { action: "query", requiresReasoning: false };
    }
    if (/\bhistory\b|\btransactions?\b/.test(t)) {
      return { action: "query", requiresReasoning: false };
    }
    if (/\bprice\b|\brate\b|\bapy\b/.test(t)) {
      return { action: "query", requiresReasoning: false };
    }
    if (hasProtocol) {
      return { action: "complex", requiresReasoning: true };
    }
    return null;
  }
  extractParams(input, action) {
    const params = {};
    const t = input.toLowerCase();
    const pctMatch = input.match(/(\d+(?:\.\d+)?)\s*%/);
    if (pctMatch) {
      params.amount = pctMatch[1];
      params.amountIsPercent = true;
    } else if (/\ball\b/.test(t)) {
      params.amount = "100";
      params.amountIsPercent = true;
    } else if (/\bhalf\b/.test(t)) {
      params.amount = "50";
      params.amountIsPercent = true;
    } else {
      const numMatch = input.match(/(\d+(?:\.\d+)?)/);
      if (numMatch) params.amount = numMatch[1];
    }
    const tokenRegex = new RegExp(`\\b(${KNOWN_TOKENS.join("|")})\\b`, "gi");
    const tokenMatches = Array.from(input.matchAll(tokenRegex)).map((m) => m[1].toUpperCase());
    const uniqueTokens = [...new Set(tokenMatches)];
    if (uniqueTokens.length > 0) {
      const directional = input.match(
        /\b(?:swap|exchange|convert|bridge)\b[\s\d.%]*\s*(\w+)\s+(?:for|to|into)\s+(\w+)/i
      );
      if (directional && KNOWN_TOKENS.includes(directional[1].toUpperCase()) && KNOWN_TOKENS.includes(directional[2].toUpperCase())) {
        params.fromToken = directional[1].toUpperCase();
        params.toToken = directional[2].toUpperCase();
      } else if (action === "send") {
        params.fromToken = uniqueTokens[0];
      } else if (uniqueTokens.length >= 2) {
        params.fromToken = uniqueTokens[0];
        params.toToken = uniqueTokens[1];
      } else {
        params.fromToken = uniqueTokens[0];
      }
    }
    const addrMatch = input.match(/0x[a-fA-F0-9]{40}/);
    if (addrMatch) params.recipient = addrMatch[0];
    else {
      const nameMatch = input.match(/\bto\s+([A-Za-z][\w.]*)\b(?!\s*(?:for|to|into))/);
      if (action === "send" && nameMatch && !KNOWN_TOKENS.includes(nameMatch[1].toUpperCase())) {
        params.recipient = nameMatch[1];
      }
    }
    const protocol = KNOWN_PROTOCOLS.find((p) => t.includes(p));
    if (protocol) params.protocol = protocol;
    const constraintMatch = input.match(
      /\b((?:no more than|at least|only if|unless|as long as)\b[^,.;]*)/i
    );
    if (constraintMatch) params.constraint = constraintMatch[1].trim();
    const timeframeMatch = input.match(
      /\b(by end of day|today|tomorrow|this week|weekly|daily|monthly|right now|asap)\b/i
    );
    if (timeframeMatch) params.timeframe = timeframeMatch[1].toLowerCase();
    const slippageMatch = input.match(/slippage[^\d%]*(\d+(?:\.\d+)?)\s*%/i);
    if (slippageMatch) params.slippage = parseFloat(slippageMatch[1]) / 100;
    const gasMatch = input.match(/gas[^$\d]*\$?(\d+(?:\.\d+)?)/i);
    if (gasMatch) params.maxGas = gasMatch[1];
    if (action === "query") {
      if (/\bbalance\b|\bportfolio\b|how much/.test(t)) params.queryType = "balance";
      else if (/\bhistory\b|\btransactions?\b/.test(t)) params.queryType = "history";
      else if (/\bprice\b|\brate\b|\bapy\b/.test(t)) params.queryType = "price";
    }
    return params;
  }
  scoreConfidence(action, params, input) {
    let score = 0.6;
    if (params.amount) score += 0.1;
    if (params.fromToken || params.toToken) score += 0.1;
    if (params.protocol) score += 0.1;
    if (action === "complex") score -= 0.1;
    if (input.split(/\s+/).length <= 2) score -= 0.1;
    return Math.max(0.2, Math.min(0.97, score));
  }
  buildGhostResponse(intent) {
    const { action, params } = intent;
    switch (action) {
      case "swap":
        return `Understood, Sovereign. Preparing to swap ${params.amount ?? "the requested amount of"} ${params.fromToken ?? "tokens"} to ${params.toToken ?? "your target asset"}.`;
      case "send":
        return `Understood, Sovereign. Sending ${params.amount ?? "the requested amount of"} ${params.fromToken ?? "tokens"} to ${params.recipient ?? "the specified recipient"}.`;
      case "earn":
        return `Understood, Sovereign. Scanning the market for the best yield on ${params.fromToken ?? "your assets"}.`;
      case "stake":
        return `Understood, Sovereign. Preparing to stake ${params.amount ?? "the requested amount of"} ${params.fromToken ?? "tokens"}.`;
      case "borrow":
        return `Understood, Sovereign. Analyzing loan parameters for your position.`;
      case "repay":
        return `Understood, Sovereign. Preparing to repay ${params.amount ?? "the requested amount of"} ${params.fromToken ?? "your debt"}.`;
      case "provide_liquidity":
        return `Understood, Sovereign. Evaluating liquidity provision for ${params.fromToken ?? "the requested pair"}.`;
      case "remove_liquidity":
        return `Understood, Sovereign. Preparing to withdraw your liquidity position.`;
      case "bridge":
        return `Understood, Sovereign. Planning a cross-chain bridge for ${params.fromToken ?? "your assets"}.`;
      case "approve":
        return `Understood, Sovereign. Preparing the approval transaction.`;
      case "query":
        return `Understood, Sovereign. Pulling your ${params.queryType ?? "requested"} information.`;
      case "complex":
        return `Understood, Sovereign. Reasoning through your request...`;
      case "clarify":
        return intent.ghostResponse;
      default:
        return `Understood, Sovereign. Processing your request.`;
    }
  }
  buildFromMatch(raw, trimmed, match) {
    const params = this.extractParams(trimmed, match.action);
    const confidence = this.scoreConfidence(match.action, params, trimmed);
    const intent = {
      action: match.action,
      confidence,
      params,
      requiresReasoning: match.requiresReasoning,
      raw,
      ghostResponse: ""
    };
    intent.ghostResponse = this.buildGhostResponse(intent);
    return intent;
  }
  // Blends embedding cosine similarity with slot-fill signals for a final score.
  blendConfidence(embSim, action, params, input) {
    let bonus = 0;
    if (params.amount) bonus += 0.05;
    if (params.fromToken || params.toToken) bonus += 0.05;
    if (params.protocol) bonus += 0.05;
    if (action === "complex") bonus -= 0.05;
    return Math.max(0.2, Math.min(0.97, embSim + bonus));
  }
  buildClarify(raw, unclearPart) {
    return {
      action: "clarify",
      confidence: 0.3,
      params: {},
      requiresReasoning: false,
      raw,
      ghostResponse: `Sovereign, could you clarify ${unclearPart}?`
    };
  }
};
var AAVE_RATES_URL = "https://aave-api-v2.aave.com/data/rates";
var FETCH_TIMEOUT_MS = 6e3;
var FALLBACK_RATES = {
  USDC: { supplyAPY: 0.03, variableBorrowAPY: 0.05, stableBorrowAPY: 0.06, ltv: 0.77 },
  ETH: { supplyAPY: 0.015, variableBorrowAPY: 0.025, stableBorrowAPY: 0.035, ltv: 0.8 },
  WBTC: { supplyAPY: 5e-3, variableBorrowAPY: 0.015, stableBorrowAPY: 0.02, ltv: 0.73 }
};
var AaveFetcher = class {
  async getRates(_network) {
    try {
      const res = await fetchWithTimeout(AAVE_RATES_URL, FETCH_TIMEOUT_MS);
      if (!res.ok) throw new Error(`Aave API responded ${res.status}`);
      const data = await res.json();
      return {
        USDC: data.USDC ?? FALLBACK_RATES.USDC,
        ETH: data.ETH ?? FALLBACK_RATES.ETH,
        WBTC: data.WBTC ?? FALLBACK_RATES.WBTC
      };
    } catch {
      return FALLBACK_RATES;
    }
  }
  async getUserPosition(address, network) {
    try {
      const res = await fetchWithTimeout(
        `${AAVE_RATES_URL}/positions/${address}?network=${network}`,
        FETCH_TIMEOUT_MS
      );
      if (!res.ok) throw new Error(`Aave API responded ${res.status}`);
      return await res.json();
    } catch {
      return void 0;
    }
  }
  /**
   * Returns the safe maximum borrow amount that keeps health factor above 1.5,
   * applying a safety buffer on top of the protocol's theoretical max LTV borrow.
   */
  calculateMaxBorrow(collateralValue, _collateralToken, rates, safetyBuffer = 0.8) {
    const ltv = this.resolveLtv(_collateralToken, rates);
    const theoreticalMax = collateralValue * ltv;
    return theoreticalMax * safetyBuffer;
  }
  resolveLtv(token, rates) {
    const entry = rates[token.toUpperCase()];
    return entry?.ltv ?? FALLBACK_RATES.USDC.ltv;
  }
};
async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch6(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
var UNISWAP_QUOTE_URL = "https://interface.gateway.uniswap.org/v2/quote";
var COINGECKO_PRICE_URL = "https://api.coingecko.com/api/v3/simple/price";
var FETCH_TIMEOUT_MS2 = 6e3;
var COINGECKO_IDS = {
  ETH: "ethereum",
  WETH: "ethereum",
  WBTC: "wrapped-bitcoin",
  CBBTC: "wrapped-bitcoin",
  USDC: "usd-coin",
  USDT: "tether",
  DAI: "dai",
  OCT: "octra",
  AERO: "aerodrome-finance"
};
var UniswapFetcher = class {
  async getQuote(fromToken, toToken, amount, network) {
    try {
      const res = await fetchWithTimeout2(
        `${UNISWAP_QUOTE_URL}?tokenIn=${fromToken}&tokenOut=${toToken}&amount=${amount}&network=${network}`,
        FETCH_TIMEOUT_MS2
      );
      if (!res.ok) throw new Error(`Uniswap quote API responded ${res.status}`);
      const data = await res.json();
      return {
        amountOut: data.amountOut ?? "0",
        priceImpact: data.priceImpact ?? 0,
        route: data.route ?? [fromToken, toToken]
      };
    } catch {
      return this.estimateFromCoingecko(fromToken, toToken, amount);
    }
  }
  async estimateFromCoingecko(fromToken, toToken, amount) {
    const fromId = COINGECKO_IDS[fromToken.toUpperCase()];
    const toId = COINGECKO_IDS[toToken.toUpperCase()];
    if (!fromId || !toId) {
      return { amountOut: "0", priceImpact: 0, route: [fromToken, toToken], estimated: true };
    }
    try {
      const res = await fetchWithTimeout2(
        `${COINGECKO_PRICE_URL}?ids=${fromId},${toId}&vs_currencies=usd`,
        FETCH_TIMEOUT_MS2
      );
      if (!res.ok) throw new Error(`CoinGecko responded ${res.status}`);
      const prices = await res.json();
      const fromUsd = prices[fromId]?.usd;
      const toUsd = prices[toId]?.usd;
      if (!fromUsd || !toUsd) throw new Error("CoinGecko missing price data");
      const amountOut = (parseFloat(amount) || 0) * fromUsd / toUsd;
      return {
        amountOut: amountOut.toString(),
        priceImpact: 3e-3,
        route: [fromToken, toToken],
        estimated: true
      };
    } catch {
      return { amountOut: "0", priceImpact: 0, route: [fromToken, toToken], estimated: true };
    }
  }
};
async function fetchWithTimeout2(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch6(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
var AERODROME_SUBGRAPH_URL = "https://api.thegraph.com/subgraphs/name/aerodrome-finance/aerodrome";
var FETCH_TIMEOUT_MS3 = 6e3;
var FALLBACK_POOLS = [
  { poolAddress: "0xfallback-usdc-aero", token0: "USDC", token1: "AERO", apr: 0.08, tvl: 5e6, fee: 3e-3 },
  { poolAddress: "0xfallback-eth-usdc", token0: "ETH", token1: "USDC", apr: 0.06, tvl: 2e7, fee: 3e-3 }
];
var AerodromeFetcher = class {
  async getPools(_network) {
    try {
      const res = await fetchWithTimeout3(AERODROME_SUBGRAPH_URL, FETCH_TIMEOUT_MS3);
      if (!res.ok) throw new Error(`Aerodrome subgraph responded ${res.status}`);
      const data = await res.json();
      return data.pools && data.pools.length > 0 ? data.pools : FALLBACK_POOLS;
    } catch {
      return FALLBACK_POOLS;
    }
  }
  async getBestYield(token, network) {
    const pools = await this.getPools(network);
    const matching = pools.filter(
      (p) => p.token0.toUpperCase() === token.toUpperCase() || p.token1.toUpperCase() === token.toUpperCase()
    );
    if (matching.length === 0) return null;
    return matching.reduce((best, p) => p.apr > best.apr ? p : best, matching[0]);
  }
};
async function fetchWithTimeout3(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch6(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
var BASE_GAS_URL = "https://api.basescan.org/api?module=gastracker&action=gasoracle";
var FETCH_TIMEOUT_MS4 = 6e3;
var FALLBACK_GAS_GWEI = "0.05";
var ETH_USD_ESTIMATE = 3e3;
var GasFetcher = class {
  async getGasPrice(_network) {
    try {
      const res = await fetchWithTimeout4(BASE_GAS_URL, FETCH_TIMEOUT_MS4);
      if (!res.ok) throw new Error(`Gas API responded ${res.status}`);
      const data = await res.json();
      return data.result?.SafeGasPrice ?? FALLBACK_GAS_GWEI;
    } catch {
      return FALLBACK_GAS_GWEI;
    }
  }
  async estimateGasCost(steps, network) {
    const gweiStr = await this.getGasPrice(network);
    const gwei = parseFloat(gweiStr) || parseFloat(FALLBACK_GAS_GWEI);
    const gasUnitsPerStep = 15e4;
    const totalGasUnits = gasUnitsPerStep * Math.max(1, steps);
    const ethCost = gwei * 1e-9 * totalGasUnits;
    const usdCost = ethCost * ETH_USD_ESTIMATE;
    return usdCost.toFixed(2);
  }
};
async function fetchWithTimeout4(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch6(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// src/reasoning/DeFiReasoner.ts
var TOKEN_USD_PRICE = {
  USDC: 1,
  USDT: 1,
  DAI: 1,
  ETH: 3e3,
  WETH: 3e3,
  WBTC: 6e4,
  CBBTC: 6e4,
  OCT: 0.5,
  AERO: 1.2
};
function priceOf(token) {
  return TOKEN_USD_PRICE[token.toUpperCase()] ?? 1;
}
var DeFiReasoner = class {
  aave = new AaveFetcher();
  uniswap = new UniswapFetcher();
  aerodrome = new AerodromeFetcher();
  gas = new GasFetcher();
  async reason(intent, context) {
    const defiCtx = await this.fetchDeFiContext(context);
    switch (intent.action) {
      case "borrow":
        return this.reasonBorrow(intent, context, defiCtx);
      case "swap":
        return this.reasonSwap(intent, context, defiCtx);
      case "earn":
        return this.reasonEarn(intent, context, defiCtx);
      case "complex":
        return /rebalance|allocat/i.test(intent.raw) ? this.reasonRebalance(intent, context, defiCtx) : this.reasonDefault(intent, context, defiCtx);
      default:
        return this.reasonDefault(intent, context, defiCtx);
    }
  }
  // ─── Borrow ─────────────────────────────────────────────────────────────
  async reasonBorrow(intent, context, defiCtx) {
    const reasoning = [];
    const warnings = [];
    const token = (intent.params.fromToken ?? Object.keys(context.balances)[0] ?? "USDC").toUpperCase();
    const balance = parseFloat(context.balances[token] ?? "0");
    const collateralAmount = intent.params.amount && !intent.params.amountIsPercent ? parseFloat(intent.params.amount) : intent.params.amountIsPercent ? balance * (parseFloat(intent.params.amount ?? "100") / 100) : balance;
    const usdValue = collateralAmount * priceOf(token);
    reasoning.push(`Checking ${token} balance: ${collateralAmount} = $${usdValue.toFixed(2)}`);
    const rates = defiCtx.protocols.aave?.rates;
    reasoning.push(`Fetching Aave V3 ${token} parameters on Base`);
    const tokenRates = rates?.[token];
    const ltv = tokenRates?.ltv ?? rates?.USDC.ltv ?? 0.75;
    const theoreticalMax = usdValue * ltv;
    reasoning.push(`${token} LTV: ${(ltv * 100).toFixed(0)}% \u2192 theoretical max borrow = $${theoreticalMax.toFixed(2)}`);
    const safetyBuffer = 0.8;
    const safeBorrow = theoreticalMax * safetyBuffer;
    reasoning.push(`Applying ${(safetyBuffer * 100).toFixed(0)}% safety buffer \u2192 safe borrow = $${safeBorrow.toFixed(2)}`);
    let constraintPct;
    if (intent.params.constraint) {
      reasoning.push(`Constraint check: ${intent.params.constraint}`);
      const pctMatch = intent.params.constraint.match(/(\d+(?:\.\d+)?)\s*%/);
      if (pctMatch) constraintPct = parseFloat(pctMatch[1]);
    }
    const variableRate = (tokenRates?.variableBorrowAPY ?? rates?.USDC.variableBorrowAPY ?? 0.05) * 100;
    const stableRate = (tokenRates?.stableBorrowAPY ?? rates?.USDC.stableBorrowAPY ?? 0.06) * 100;
    const variablePasses = constraintPct === void 0 || variableRate <= constraintPct;
    const stablePasses = constraintPct === void 0 || stableRate <= constraintPct;
    reasoning.push(`Current variable rate: ${variableRate.toFixed(2)}% ${variablePasses ? "passes constraint" : "fails constraint"}`);
    reasoning.push(`Current stable rate: ${stableRate.toFixed(2)}% ${stablePasses ? "passes constraint" : "fails constraint"}`);
    if (constraintPct !== void 0 && !variablePasses && !stablePasses) {
      warnings.push(`No Aave rate for ${token} satisfies the constraint "${intent.params.constraint}"`);
    }
    const healthFactor = 1 / (ltv * safetyBuffer);
    reasoning.push(`Health factor at safe borrow: ${healthFactor.toFixed(2)} (target > 1.5)`);
    if (healthFactor < 2) {
      warnings.push(`Health factor (${healthFactor.toFixed(2)}) is below 2.0 \u2014 consider borrowing less for extra safety margin.`);
    }
    reasoning.push("Building Aave supply + borrow sequence");
    const steps = [
      {
        index: 0,
        protocol: "aave",
        action: "approve",
        description: `Approve Aave V3 to spend ${collateralAmount} ${token}`,
        params: { token, amount: collateralAmount.toString() },
        estimatedGas: await this.gas.estimateGasCost(1, context.network),
        requiresApproval: true
      },
      {
        index: 1,
        protocol: "aave",
        action: "supply",
        description: `Supply ${collateralAmount} ${token} as collateral`,
        params: { token, amount: collateralAmount.toString() },
        estimatedGas: await this.gas.estimateGasCost(1, context.network)
      },
      {
        index: 2,
        protocol: "aave",
        action: "borrow",
        description: `Borrow $${safeBorrow.toFixed(2)} against ${token} collateral`,
        params: { collateralToken: token, borrowUsd: safeBorrow.toFixed(2), rateMode: variablePasses ? "variable" : "stable" },
        estimatedGas: await this.gas.estimateGasCost(1, context.network)
      }
    ];
    return {
      steps,
      estimatedGas: await this.gas.estimateGasCost(steps.length, context.network),
      estimatedOutcome: `Borrow up to $${safeBorrow.toFixed(2)} against ${collateralAmount} ${token} while keeping health factor at ${healthFactor.toFixed(2)}`,
      riskLevel: healthFactor < 1.8 ? "high" : healthFactor < 2.5 ? "medium" : "low",
      warnings,
      reasoning,
      requiresApproval: true,
      totalFees: "0.00",
      confidence: constraintPct !== void 0 && !variablePasses && !stablePasses ? 0.4 : 0.85
    };
  }
  // ─── Swap ───────────────────────────────────────────────────────────────
  async reasonSwap(intent, context, defiCtx) {
    const reasoning = [];
    const warnings = [];
    const fromToken = (intent.params.fromToken ?? Object.keys(context.balances)[0] ?? "USDC").toUpperCase();
    const toToken = (intent.params.toToken ?? "USDC").toUpperCase();
    const balance = parseFloat(context.balances[fromToken] ?? "0");
    const amount = intent.params.amount && intent.params.amountIsPercent ? balance * (parseFloat(intent.params.amount) / 100) : parseFloat(intent.params.amount ?? balance.toString());
    reasoning.push(`Verifying ${fromToken} balance: have ${balance}, need ${amount}`);
    if (amount > balance) {
      warnings.push(`Insufficient ${fromToken} balance: requested ${amount}, available ${balance}`);
    }
    const quote = await this.uniswap.getQuote(fromToken, toToken, amount.toString(), context.network);
    reasoning.push(
      `Uniswap quote: ${amount} ${fromToken} \u2192 ${quote.amountOut} ${toToken} (price impact ${(quote.priceImpact * 100).toFixed(2)}%)${quote.estimated ? " [ESTIMATED]" : ""}`
    );
    if (quote.priceImpact > 0.01) {
      warnings.push(`Price impact ${(quote.priceImpact * 100).toFixed(2)}% exceeds 1% \u2014 consider splitting the trade.`);
    }
    if (intent.params.slippage !== void 0 && quote.priceImpact > intent.params.slippage) {
      warnings.push(
        `Price impact ${(quote.priceImpact * 100).toFixed(2)}% exceeds your slippage tolerance of ${(intent.params.slippage * 100).toFixed(2)}%`
      );
    }
    const steps = [];
    if (fromToken !== "ETH") {
      steps.push({
        index: 0,
        protocol: "uniswap",
        action: "approve",
        description: `Approve Uniswap router to spend ${amount} ${fromToken}`,
        params: { token: fromToken, amount: amount.toString() },
        estimatedGas: await this.gas.estimateGasCost(1, context.network),
        requiresApproval: true
      });
    }
    steps.push({
      index: steps.length,
      protocol: "uniswap",
      action: "swap",
      description: `Swap ${amount} ${fromToken} for ${toToken}`,
      params: { fromToken, toToken, amount: amount.toString(), expectedOut: quote.amountOut },
      estimatedGas: await this.gas.estimateGasCost(1, context.network)
    });
    reasoning.push("Building Uniswap swap sequence");
    return {
      steps,
      estimatedGas: await this.gas.estimateGasCost(steps.length, context.network),
      estimatedOutcome: `Receive approximately ${quote.amountOut} ${toToken}`,
      riskLevel: quote.priceImpact > 0.03 ? "high" : quote.priceImpact > 0.01 ? "medium" : "low",
      warnings,
      reasoning,
      requiresApproval: fromToken !== "ETH",
      totalFees: "0.00",
      confidence: amount > balance ? 0.3 : 0.9
    };
  }
  // ─── Earn ───────────────────────────────────────────────────────────────
  async reasonEarn(intent, context, defiCtx) {
    const reasoning = [];
    const warnings = [];
    const token = (intent.params.fromToken ?? Object.keys(context.balances)[0] ?? "USDC").toUpperCase();
    const balance = parseFloat(context.balances[token] ?? "0");
    const rates = defiCtx.protocols.aave?.rates;
    const aaveAPY = rates?.[token]?.supplyAPY ?? rates?.USDC.supplyAPY;
    reasoning.push(`Scanning Aave V3 supply APY for ${token}: ${aaveAPY !== void 0 ? `${(aaveAPY * 100).toFixed(2)}%` : "unavailable"}`);
    const bestPool = await this.aerodrome.getBestYield(token, context.network);
    reasoning.push(`Scanning Aerodrome pools for ${token}: ${bestPool ? `${(bestPool.apr * 100).toFixed(2)}% APR in ${bestPool.poolAddress}` : "no pool found"}`);
    const hasRiskPreference = /\b(safe|low risk|conservative|no impermanent loss)\b/i.test(intent.raw);
    const hasAggressivePreference = /\b(aggressive|high yield|max yield|risk it)\b/i.test(intent.raw);
    if (aaveAPY === void 0 && !bestPool) {
      return {
        steps: [],
        estimatedGas: "0.00",
        estimatedOutcome: "No yield data available",
        riskLevel: "low",
        warnings: ["Sovereign, no yield data is currently available for this asset."],
        reasoning,
        requiresApproval: false,
        totalFees: "0.00",
        confidence: 0.3
      };
    }
    if (bestPool) {
      reasoning.push(`Aerodrome LP carries impermanent loss risk on the ${bestPool.token0}/${bestPool.token1} pair`);
    }
    let chooseLp = false;
    if (bestPool && aaveAPY !== void 0) {
      if (hasRiskPreference) {
        chooseLp = false;
        reasoning.push("User requested low-risk yield \u2192 preferring Aave lending over LP");
      } else if (hasAggressivePreference || bestPool.apr > aaveAPY) {
        chooseLp = true;
        reasoning.push(`Aerodrome APR (${(bestPool.apr * 100).toFixed(2)}%) exceeds Aave APY (${(aaveAPY * 100).toFixed(2)}%) \u2192 recommending LP`);
        if (!hasRiskPreference && !hasAggressivePreference) {
          warnings.push("No risk preference stated \u2014 defaulted to the higher-yield option. Impermanent loss applies to LP positions.");
        }
      }
    } else if (bestPool && aaveAPY === void 0) {
      chooseLp = true;
    }
    const steps = [];
    if (chooseLp && bestPool) {
      steps.push({
        index: 0,
        protocol: "aerodrome",
        action: "provide_liquidity",
        description: `Provide ${balance} ${token} to ${bestPool.token0}/${bestPool.token1} pool at ${(bestPool.apr * 100).toFixed(2)}% APR`,
        params: { token, poolAddress: bestPool.poolAddress, apr: bestPool.apr.toString() },
        estimatedGas: await this.gas.estimateGasCost(1, context.network)
      });
    } else {
      steps.push({
        index: 0,
        protocol: "aave",
        action: "supply",
        description: `Supply ${balance} ${token} to Aave V3 at ${aaveAPY !== void 0 ? (aaveAPY * 100).toFixed(2) : "?"}% APY`,
        params: { token, apy: (aaveAPY ?? 0).toString() },
        estimatedGas: await this.gas.estimateGasCost(1, context.network)
      });
    }
    return {
      steps,
      estimatedGas: await this.gas.estimateGasCost(steps.length, context.network),
      estimatedOutcome: chooseLp && bestPool ? `Earn ~${(bestPool.apr * 100).toFixed(2)}% APR via Aerodrome LP` : `Earn ~${((aaveAPY ?? 0) * 100).toFixed(2)}% APY via Aave supply`,
      riskLevel: chooseLp ? "medium" : "low",
      warnings,
      reasoning,
      requiresApproval: true,
      totalFees: "0.00",
      confidence: 0.8
    };
  }
  // ─── Rebalance ──────────────────────────────────────────────────────────
  async reasonRebalance(intent, context, defiCtx) {
    const reasoning = [];
    const warnings = [];
    const targets = this.parseAllocations(intent.raw);
    reasoning.push(`Parsed target allocations: ${JSON.stringify(targets)}`);
    const currentUsd = {};
    let totalUsd = 0;
    for (const [token, amountStr] of Object.entries(context.balances)) {
      const usd = parseFloat(amountStr) * priceOf(token);
      currentUsd[token.toUpperCase()] = usd;
      totalUsd += usd;
    }
    reasoning.push(`Current portfolio value: $${totalUsd.toFixed(2)}`);
    if (Object.keys(targets).length === 0) {
      warnings.push("Sovereign, no explicit target allocation was found \u2014 please specify percentages per asset.");
      return {
        steps: [],
        estimatedGas: "0.00",
        estimatedOutcome: "No rebalance performed \u2014 target allocation unclear",
        riskLevel: "low",
        warnings,
        reasoning,
        requiresApproval: false,
        totalFees: "0.00",
        confidence: 0.3
      };
    }
    const deltas = [];
    for (const [token, fraction] of Object.entries(targets)) {
      const targetUsd = totalUsd * fraction;
      const haveUsd = currentUsd[token] ?? 0;
      deltas.push({ token, deltaUsd: targetUsd - haveUsd });
    }
    const sells = deltas.filter((d) => d.deltaUsd < -0.01).sort((a, b) => a.deltaUsd - b.deltaUsd);
    const buys = deltas.filter((d) => d.deltaUsd > 0.01).sort((a, b) => b.deltaUsd - a.deltaUsd);
    reasoning.push(`Sells: ${sells.map((s) => `${s.token} $${Math.abs(s.deltaUsd).toFixed(2)}`).join(", ") || "none"}`);
    reasoning.push(`Buys: ${buys.map((b) => `${b.token} $${b.deltaUsd.toFixed(2)}`).join(", ") || "none"}`);
    reasoning.push("Ordering sells before buys to minimize gas and avoid temporary undercollateralization");
    const steps = [];
    for (const sell of sells) {
      steps.push({
        index: steps.length,
        protocol: "uniswap",
        action: "sell",
        description: `Sell $${Math.abs(sell.deltaUsd).toFixed(2)} of ${sell.token} toward target allocation`,
        params: { token: sell.token, usdAmount: Math.abs(sell.deltaUsd).toFixed(2) },
        estimatedGas: await this.gas.estimateGasCost(1, context.network)
      });
    }
    for (const buy of buys) {
      steps.push({
        index: steps.length,
        protocol: "uniswap",
        action: "buy",
        description: `Buy $${buy.deltaUsd.toFixed(2)} of ${buy.token} toward target allocation`,
        params: { token: buy.token, usdAmount: buy.deltaUsd.toFixed(2) },
        estimatedGas: await this.gas.estimateGasCost(1, context.network)
      });
    }
    return {
      steps,
      estimatedGas: await this.gas.estimateGasCost(steps.length, context.network),
      estimatedOutcome: `Rebalance portfolio toward ${JSON.stringify(targets)}`,
      riskLevel: "medium",
      warnings,
      reasoning,
      requiresApproval: steps.length > 0,
      totalFees: "0.00",
      confidence: 0.75
    };
  }
  /** Parses "50% ETH, 50% USDC"-style allocation targets from free text. */
  parseAllocations(raw) {
    const targets = {};
    const matches = raw.matchAll(/(\d+(?:\.\d+)?)\s*%\s*(?:in\s+|of\s+)?([A-Za-z]{2,6})/gi);
    for (const m of matches) {
      targets[m[2].toUpperCase()] = parseFloat(m[1]) / 100;
    }
    return targets;
  }
  // ─── Default / generic fallback ────────────────────────────────────────
  async reasonDefault(intent, context, _defiCtx) {
    const reasoning = [
      `Action '${intent.action}' does not have a specialized reasoning path yet \u2014 building a generic plan.`
    ];
    return {
      steps: [
        {
          index: 0,
          protocol: intent.params.protocol ?? "unknown",
          action: intent.action,
          description: `Execute ${intent.action} as requested`,
          params: Object.fromEntries(
            Object.entries(intent.params).map(([k, v]) => [k, String(v)])
          ),
          estimatedGas: await this.gas.estimateGasCost(1, context.network)
        }
      ],
      estimatedGas: await this.gas.estimateGasCost(1, context.network),
      estimatedOutcome: `Generic execution of ${intent.action}`,
      riskLevel: "medium",
      warnings: [],
      reasoning,
      requiresApproval: true,
      totalFees: "0.00",
      confidence: 0.5
    };
  }
  // ─── Context fetching ───────────────────────────────────────────────────
  async fetchDeFiContext(context) {
    const [rates, pools, gasPrice] = await Promise.all([
      this.aave.getRates(context.network).catch(() => void 0),
      this.aerodrome.getPools(context.network).catch(() => []),
      this.gas.getGasPrice(context.network).catch(() => void 0)
    ]);
    return {
      balances: context.balances,
      network: context.network,
      address: context.address,
      gasPrice,
      protocols: {
        aave: rates ? { rates } : void 0,
        aerodrome: { pools }
      }
    };
  }
};
var REPLAY_WINDOW_MS = 5 * 60 * 1e3;
var MAX_AUDIT_ENTRIES = 1e3;
var auditLog = [];
function getAuditLog() {
  return [...auditLog];
}
function recordAudit(entry) {
  auditLog.push(entry);
  if (auditLog.length > MAX_AUDIT_ENTRIES) {
    auditLog.splice(0, auditLog.length - MAX_AUDIT_ENTRIES);
  }
}
function toHex(bytes) {
  return Buffer.from(bytes).toString("hex");
}
function fromHex(hex) {
  return new Uint8Array(Buffer.from(hex, "hex"));
}
function encodePublicKey(publicKey) {
  const serialized = { dsa: toHex(publicKey.dsa), kem: toHex(publicKey.kem) };
  return Buffer.from(JSON.stringify(serialized)).toString("base64");
}
function decodePublicKey(encoded) {
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}
function serializeKeypair(keypair) {
  return Buffer.from(
    JSON.stringify({
      signingKey: toHex(keypair.signingKey),
      encapsulationKey: toHex(keypair.encapsulationKey),
      dsa: toHex(keypair.publicKey.dsa),
      kem: toHex(keypair.publicKey.kem),
      address: keypair.address
    })
  ).toString("hex");
}
function deserializeKeypair(blob) {
  const parsed = JSON.parse(Buffer.from(blob, "hex").toString("utf8"));
  return {
    signingKey: fromHex(parsed.signingKey),
    encapsulationKey: fromHex(parsed.encapsulationKey),
    publicKey: { dsa: fromHex(parsed.dsa), kem: fromHex(parsed.kem) },
    address: parsed.address
  };
}
function aesEncrypt(key, plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}
function aesDecrypt(key, sealed) {
  const iv = sealed.subarray(0, 12);
  const authTag = sealed.subarray(12, 28);
  const ciphertext = sealed.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
var PQCTransport = class {
  // A keypair always exists from construction so seal()/getPublicKey() work
  // immediately; init() exists to swap in a persisted identity later.
  keypair = generatePQCKeypair();
  async init(existingPrivateKey) {
    this.keypair = existingPrivateKey ? deserializeKeypair(existingPrivateKey) : generatePQCKeypair();
  }
  get isInitialized() {
    return true;
  }
  /** Serializes this node's keypair for persistence (see deserializeKeypair). */
  exportPrivateKey() {
    return serializeKeypair(this.requireKeypair());
  }
  getPublicKey() {
    return encodePublicKey(this.requireKeypair().publicKey);
  }
  async seal(payload, recipientPublicKey) {
    const keypair = this.requireKeypair();
    const recipient = decodePublicKey(recipientPublicKey);
    const json = JSON.stringify(payload);
    const { ciphertext, sharedSecret } = encapsulateKey(fromHex(recipient.kem));
    const encryptedPayload = aesEncrypt(sharedSecret, new TextEncoder().encode(json)).toString("base64");
    const signature = ml_dsa65.sign(keypair.signingKey, sha256(new TextEncoder().encode(encryptedPayload)));
    const envelope = {
      kemCiphertext: Buffer.from(ciphertext).toString("base64"),
      encryptedPayload,
      senderPublicKey: this.getPublicKey(),
      signature: toHex(signature),
      timestamp: Date.now(),
      version: "1.0"
    };
    recordAudit({
      timestamp: envelope.timestamp,
      operation: "seal",
      payloadType: typeof payload,
      kemAlgorithm: "ML-KEM-768",
      sigAlgorithm: "ML-DSA-65",
      success: true
    });
    return envelope;
  }
  async unseal(envelope) {
    const keypair = this.requireKeypair();
    let success = false;
    try {
      const verified = await this.verify(envelope, envelope.senderPublicKey);
      if (!verified) {
        throw new Error("PQCTransport.unseal: signature verification failed");
      }
      if (Date.now() - envelope.timestamp > REPLAY_WINDOW_MS) {
        throw new Error("PQCTransport.unseal: envelope expired (possible replay)");
      }
      const kemCiphertext = new Uint8Array(Buffer.from(envelope.kemCiphertext, "base64"));
      const sharedSecret = decapsulateKey(kemCiphertext, keypair.encapsulationKey);
      const sealed = Buffer.from(envelope.encryptedPayload, "base64");
      const plaintext = aesDecrypt(sharedSecret, sealed);
      const payload = JSON.parse(plaintext.toString("utf8"));
      success = true;
      return payload;
    } finally {
      recordAudit({
        timestamp: Date.now(),
        operation: "unseal",
        payloadType: "unknown",
        kemAlgorithm: "ML-KEM-768",
        sigAlgorithm: "ML-DSA-65",
        success
      });
    }
  }
  async verify(envelope, senderPublicKey) {
    const sender = decodePublicKey(senderPublicKey);
    const hash = sha256(new TextEncoder().encode(envelope.encryptedPayload));
    let success = false;
    try {
      success = ml_dsa65.verify(fromHex(sender.dsa), hash, fromHex(envelope.signature));
      return success;
    } catch {
      success = false;
      return false;
    } finally {
      recordAudit({
        timestamp: Date.now(),
        operation: "verify",
        payloadType: "envelope",
        kemAlgorithm: "ML-KEM-768",
        sigAlgorithm: "ML-DSA-65",
        success
      });
    }
  }
  /** Records a broadcast audit entry (the broadcast itself reuses seal() for the envelope). */
  recordBroadcast(payloadType, success) {
    recordAudit({
      timestamp: Date.now(),
      operation: "broadcast",
      payloadType,
      kemAlgorithm: "ML-KEM-768",
      sigAlgorithm: "ML-DSA-65",
      success
    });
  }
  /** Signs an arbitrary hash (e.g. a model commitment) with this node's ML-DSA-65 key. */
  signHash(hashHex) {
    const keypair = this.requireKeypair();
    const signature = ml_dsa65.sign(keypair.signingKey, fromHex(hashHex));
    return toHex(signature);
  }
  requireKeypair() {
    if (!this.keypair) {
      throw new Error("PQCTransport: call init() before use");
    }
    return this.keypair;
  }
};
var pqcTransport = new PQCTransport();

// src/crypto/keys.ts
var COORDINATOR_PUBLIC_KEY = process.env.VEIL_COORDINATOR_PUBKEY ?? pqcTransport.getPublicKey();
var OCTRA_NODE_PUBKEY = process.env.OCTRA_NODE_PUBKEY ?? pqcTransport.getPublicKey();
process.env.VEIL_NODE_PRIVATE_KEY ?? null;

// src/training/GhostTrainer.ts
var EMPTY_CIRCLE_CONTEXT = { availableProtocols: [], userBalances: {} };
var GhostTrainer = class {
  queue = [];
  maxQueueSize;
  keypair;
  nodeId;
  onRoundTrigger;
  constructor(options = {}) {
    this.keypair = options.keypair ?? generatePQCKeypair();
    this.nodeId = options.nodeId ?? `node-${this.keypair.address.slice(2, 10)}`;
    this.maxQueueSize = options.maxQueueSize ?? 1e4;
    this.onRoundTrigger = options.onRoundTrigger;
  }
  async collectTrainingPair(intent, plan2, outcome, txHash) {
    const { encryptedInput, encryptedOutput, circleId } = await this.encryptAndStore(
      intent,
      JSON.stringify(plan2)
    );
    const pair = {
      id: `tp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      encryptedInput,
      encryptedOutput,
      outcome,
      txHash,
      timestamp: Date.now(),
      nodeId: this.nodeId,
      circleId
    };
    this.queue.push(pair);
    if (this.queue.length >= this.maxQueueSize) {
      const pairs = await this.getEncryptedPairs();
      this.onRoundTrigger?.(pairs);
    }
  }
  /**
   * Encrypts via an Octra GhostCircle (RLWE/FHE), then wraps each ciphertext
   * in a PQC envelope addressed to the Octra node before submission — so the
   * payload is never sent over the wire as plain FHE ciphertext, only as a
   * sealed PQCEnvelope. The returned strings are JSON-serialized envelopes,
   * not raw ciphertext.
   *
   * WIRE: OCTRA_NODE_PUBKEY is a placeholder until Octra publishes per-node
   * public keys via RPC (ghostPollTx / node_status) — see src/crypto/keys.ts.
   */
  async encryptAndStore(input, output) {
    const session = new CircleSession({ keypair: this.keypair, reuse: true });
    await session.create();
    try {
      const inputCt = await session.encryptQuery(input, EMPTY_CIRCLE_CONTEXT);
      const outputCt = await session.encryptQuery(output, EMPTY_CIRCLE_CONTEXT);
      const circleId = session.ghostCircleId ?? session.circle?.address ?? "unknown";
      const inputEnvelope = await pqcTransport.seal(Buffer.from(inputCt).toString("base64"), OCTRA_NODE_PUBKEY);
      const outputEnvelope = await pqcTransport.seal(Buffer.from(outputCt).toString("base64"), OCTRA_NODE_PUBKEY);
      return {
        encryptedInput: JSON.stringify(inputEnvelope),
        encryptedOutput: JSON.stringify(outputEnvelope),
        circleId
      };
    } finally {
      await session.teardown();
    }
  }
  async getEncryptedPairs() {
    const pairs = this.queue;
    this.queue = [];
    return pairs;
  }
  get queueSize() {
    return this.queue.length;
  }
  /**
   * Computes a local gradient over a batch of encrypted pairs, then seals it
   * before it ever leaves this node — the coordinator only ever sees a
   * PQCEnvelope, never the raw gradient digest.
   *
   * WIRE: once Octra's RPC exposes gradient computation, submit the pairs via
   * ghostSubmitTx with op type 'gradient_compute' and seal the resulting
   * encrypted gradient string. Today the pre-seal digest is a deterministic
   * hash of the encrypted pairs — correct interface, mock implementation.
   */
  async computeLocalGradient(pairs) {
    const hash = createHash("sha256");
    for (const pair of pairs) {
      hash.update(pair.encryptedInput);
      hash.update(pair.encryptedOutput);
    }
    const digest = hash.digest("hex");
    return JSON.stringify(await pqcTransport.seal(digest, COORDINATOR_PUBLIC_KEY));
  }
};

// src/Ghost.ts
var DEFAULT_API_URL = "https://api.veilprotocol.net";
var CHAIN_IDS = { base: 8453, "base-sepolia": 84532 };
var Ghost = class {
  parser;
  reasoner;
  trainer;
  config;
  lastInstruction = "";
  constructor(config) {
    this.config = { apiUrl: DEFAULT_API_URL, enableTraining: true, ...config };
    this.parser = new IntentParser();
    this.reasoner = new DeFiReasoner();
    this.trainer = new GhostTrainer({ keypair: config.keypair, nodeId: config.nodeId });
  }
  async execute(instruction, context) {
    this.lastInstruction = instruction;
    const intent = this.parser.parse(instruction, context);
    let plan2;
    if (intent.requiresReasoning) {
      plan2 = await this.reasoner.reason(intent, context);
    }
    const requiresClarification = intent.action === "clarify";
    const executionReady = !requiresClarification && (plan2 ? plan2.steps.length > 0 : intent.action !== "query");
    const result = {
      intent,
      plan: plan2,
      ghostResponse: intent.ghostResponse,
      executionReady,
      requiresClarification
    };
    if (requiresClarification && this.config.llmClient) {
      try {
        result.ghostResponse = await this.config.llmClient.chat(
          [{ role: "user", content: instruction }],
          context
        );
      } catch {
      }
    }
    if (this.config.enableTraining !== false && !requiresClarification) {
      const trainingPlan = plan2 ?? this.buildSyntheticPlan(intent);
      void this.trainer.collectTrainingPair(instruction, trainingPlan, "success").catch(() => {
      });
    }
    return result;
  }
  // PQC: ML-DSA-65 signing, quantum resistant
  /** Signs every step of an approved plan and broadcasts each signed step to api.veilprotocol.net/ghost/steps. */
  async sign(plan2, context) {
    const keypair = this.config.keypair ?? (this.config.keypair = generatePQCKeypair());
    const txHashes = [];
    let success = true;
    for (const step2 of plan2.steps) {
      let txHash;
      try {
        txHash = this.signStep(step2, context, keypair);
        txHashes.push(txHash);
      } catch {
        success = false;
        continue;
      }
      void (async () => {
        try {
          const envelope = await pqcTransport.seal({ txHash, step: step2, network: context.network }, COORDINATOR_PUBLIC_KEY);
          const res = await fetch6(`${this.config.apiUrl}/ghost/steps`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(envelope)
          });
          pqcTransport.recordBroadcast("ghost-step", res.ok);
        } catch {
          console.warn("[Ghost] sign(): /ghost/steps relay unreachable, signed step not broadcast");
          pqcTransport.recordBroadcast("ghost-step", false);
        }
      })();
    }
    if (this.config.enableTraining !== false) {
      void this.trainer.collectTrainingPair(this.lastInstruction, plan2, success ? "success" : "failed", txHashes[0]).catch(() => {
      });
    }
    return { txHashes, success };
  }
  /** Streams Ghost's response token-by-token. Clarify intents pipe the Anthropic SSE stream
   *  through the generator; all other intents yield the static ghost response as a single chunk. */
  async *stream(instruction, context) {
    const intent = this.parser.parse(instruction, context);
    if (intent.action === "clarify" && this.config.llmClient) {
      yield* this.config.llmClient.stream([{ role: "user", content: instruction }], context);
      return;
    }
    const result = await this.execute(instruction, context);
    yield result.ghostResponse;
  }
  signStep(step2, context, keypair) {
    const tx = {
      to: context.address,
      data: step2.calldata ?? "0x",
      value: 0n,
      nonce: step2.index,
      chainId: CHAIN_IDS[context.network]
    };
    const signature = signTransaction(tx, keypair.signingKey);
    const stepFingerprint = ethers.toUtf8Bytes(`${step2.protocol}:${step2.action}:${step2.index}`);
    return ethers.keccak256(ethers.concat([stepFingerprint, signature]));
  }
  buildSyntheticPlan(intent) {
    return {
      steps: [
        {
          index: 0,
          protocol: intent.params.protocol ?? "none",
          action: intent.action,
          description: `${intent.action} (no reasoning required)`,
          params: Object.fromEntries(Object.entries(intent.params).map(([k, v]) => [k, String(v)])),
          estimatedGas: "0.00"
        }
      ],
      estimatedGas: "0.00",
      estimatedOutcome: `Direct execution of ${intent.action}`,
      riskLevel: "low",
      warnings: [],
      reasoning: [],
      requiresApproval: false,
      totalFees: "0.00",
      confidence: intent.confidence
    };
  }
};
var VEIL_NODE_REGISTRY_ABI = [
  "event NodeRegistered(address indexed node, uint256 stakeAmount)",
  "event NodeDeregistered(address indexed node)",
  "function isRegistered(address node) view returns (bool)"
];
var DEFAULT_API_URL2 = "https://api.veilprotocol.net";
var DEFAULT_RPC_URL = "https://sepolia.base.org";
var AGGREGATE_PK_SEED = "veil-federated-coordinator-pk";
var FederatedCoordinator = class {
  nodeRegistryAddress;
  apiUrl;
  provider;
  constructor(options = {}) {
    this.nodeRegistryAddress = options.nodeRegistryAddress ?? "0xed79Cf810eeF76F8a7379a79A1Be304f0CFE5f05";
    this.apiUrl = options.apiUrl ?? DEFAULT_API_URL2;
    this.provider = new ethers.JsonRpcProvider(options.rpcUrl ?? DEFAULT_RPC_URL);
  }
  /**
   * Discovers active nodes by reading NodeRegistered events from
   * VeilNodeRegistry.sol, then confirming each is still registered via
   * isRegistered (excludes nodes that were later deregistered).
   */
  async getActiveNodes() {
    try {
      const registry = new ethers.Contract(this.nodeRegistryAddress, VEIL_NODE_REGISTRY_ABI, this.provider);
      const events = await registry.queryFilter(registry.filters.NodeRegistered());
      const candidates = [...new Set(events.map((e) => e.args?.node).filter(Boolean))];
      const active = [];
      for (const node of candidates) {
        const isRegistered = await registry.isRegistered(node);
        if (isRegistered) active.push(node);
      }
      return active;
    } catch {
      return [];
    }
  }
  async initiateTrainingRound() {
    const nodes = await this.getActiveNodes();
    const roundId = `round-${Date.now()}`;
    const round = {
      roundId,
      startTime: Date.now(),
      nodeCount: nodes.length,
      pairsProcessed: 0,
      encryptedModelHash: "",
      status: "pending"
    };
    try {
      const envelope = await pqcTransport.seal({ roundId, nodes }, COORDINATOR_PUBLIC_KEY);
      const res = await fetch6(`${this.apiUrl}/training/round/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envelope)
      });
      if (res.ok) {
        const data = await res.json();
        return { ...round, ...data, status: data.status ?? "aggregating" };
      }
    } catch {
    }
    return { ...round, status: "aggregating" };
  }
  /**
   * Aggregates per-node encrypted gradients using fhe_add. Each gradient
   * is a serialized PQCEnvelope (sealed by GhostTrainer.computeLocalGradient);
   * it is unsealed to recover the hex digest, mapped to an FHE-scaled value,
   * and homomorphically summed — no gradient is ever decrypted by anyone but
   * this coordinator, and it is never persisted in plaintext. The aggregate
   * is re-sealed before being returned to the caller.
   */
  async aggregateGradients(nodeGradients) {
    if (nodeGradients.length === 0) {
      throw new Error("FederatedCoordinator.aggregateGradients: nodeGradients must not be empty");
    }
    const gradients = await Promise.all(
      nodeGradients.map(async (ng) => await pqcTransport.unseal(JSON.parse(ng)))
    );
    const pk = fhe_load_pk(new TextEncoder().encode(AGGREGATE_PK_SEED));
    const scaledValues = gradients.map((g) => fhe_scale(gradientToFloat(g), pk.scale));
    const aggregate = scaledValues.reduce((acc, v) => fhe_add(acc, v));
    const aggregatedHex = aggregate.scaled.toString(16);
    return JSON.stringify(await pqcTransport.seal(aggregatedHex, COORDINATOR_PUBLIC_KEY));
  }
  async commitModelHash(modelHash, roundId) {
    try {
      const signature = pqcTransport.signHash(modelHash);
      const res = await fetch6(`${this.apiUrl}/training/model/commit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modelHash, roundId, signature })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.txHash) return data.txHash;
      }
    } catch {
    }
    return `0xmock${modelHash.slice(0, 56)}`;
  }
  /**
   * Broadcasts weights wrapped in a PQC envelope.
   *
   * WIRE: ML-KEM-768 has no true broadcast mode — each recipient needs its
   * own encapsulation against its own KEM public key. Once the node registry
   * exposes per-node public keys, seal once per active node here instead of
   * sealing to COORDINATOR_PUBLIC_KEY.
   */
  async broadcastWeights(encryptedWeights) {
    try {
      const envelope = await pqcTransport.seal({ weights: encryptedWeights, timestamp: Date.now() }, COORDINATOR_PUBLIC_KEY);
      const res = await fetch6(`${this.apiUrl}/training/weights`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envelope)
      });
      pqcTransport.recordBroadcast("weights", res.ok);
    } catch {
      pqcTransport.recordBroadcast("weights", false);
    }
  }
  async scheduleRound(intervalHours) {
    await new Promise((resolve) => {
      setTimeout(() => resolve(), intervalHours * 60 * 60 * 1e3);
    });
    await this.initiateTrainingRound();
  }
};
function gradientToFloat(gradientHex) {
  const slice = gradientHex.slice(0, 8) || "0";
  const intVal = parseInt(slice, 16) || 0;
  return intVal / 4294967295;
}

// src/training/TrainingScheduler.ts
var DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1e3;
var TrainingScheduler = class {
  constructor(intervalMs = DEFAULT_INTERVAL_MS) {
    this.intervalMs = intervalMs;
  }
  intervalMs;
  timer;
  lastRound = 0;
  nextRound = 0;
  coordinator;
  trainer;
  start(coordinator, trainer) {
    this.coordinator = coordinator;
    this.trainer = trainer;
    this.lastRound = Date.now();
    this.nextRound = this.lastRound + this.intervalMs;
    this.timer = setInterval(() => {
      void this.triggerNow();
    }, this.intervalMs);
    this.timer.unref?.();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = void 0;
  }
  /** Manually triggers a training round, e.g. from an API endpoint. */
  async triggerNow() {
    if (!this.coordinator) return;
    await this.coordinator.initiateTrainingRound();
    this.lastRound = Date.now();
    this.nextRound = this.lastRound + this.intervalMs;
  }
  getStatus() {
    return {
      lastRound: this.lastRound,
      nextRound: this.nextRound,
      queueSize: this.trainer?.queueSize ?? 0
    };
  }
};

// src/crypto/DeidentificationPipeline.ts
var KNOWN_TOKENS2 = [
  "USDC",
  "USDT",
  "DAI",
  "ETH",
  "WETH",
  "WBTC",
  "CBBTC",
  "CBETH",
  "OCT",
  "AERO",
  "WELL"
];
var TOKEN_ALT = [...KNOWN_TOKENS2].sort((a, b) => b.length - a.length).join("|");
var PATTERNS = [
  { regex: /0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/g, type: "TX_HASH" },
  { regex: /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g, type: "WALLET" },
  { regex: /\b[a-zA-Z0-9][a-zA-Z0-9-]*\.eth\b/g, type: "ENS" },
  { regex: new RegExp(`\\d+(?:\\.\\d+)?\\s*(?:${TOKEN_ALT})\\b`, "g"), type: "AMOUNT" },
  { regex: /\$\d[\d,]*(?:\.\d+)?/g, type: "USD" }
];
var DeidentificationPipeline = class {
  /**
   * Replaces sensitive patterns with opaque placeholders. Pre-seeds vault
   * from UserContext so context.address and non-zero balances get deterministic
   * placeholder assignment when they appear in the message.
   * Bare numeric amounts without a known token suffix are intentionally not stripped.
   */
  deidentify(message, context) {
    const vault = {};
    const counters = {};
    const reverse = /* @__PURE__ */ new Map();
    if (context.address) {
      counters["WALLET"] = 1;
      vault["[WALLET_0]"] = context.address;
      reverse.set(context.address.toLowerCase(), "[WALLET_0]");
    }
    let amountIdx = 0;
    for (const [token, rawAmount] of Object.entries(context.balances)) {
      if (!rawAmount || parseFloat(rawAmount) === 0) continue;
      const placeholder = `[AMOUNT_${amountIdx}]`;
      vault[placeholder] = `${rawAmount} ${token}`;
      reverse.set(`${rawAmount} ${token}`.toLowerCase(), placeholder);
      reverse.set(`${rawAmount}${token}`.toLowerCase(), placeholder);
      amountIdx++;
    }
    counters["AMOUNT"] = amountIdx;
    const getPlaceholder = (type, match) => {
      const key = match.toLowerCase();
      const existing = reverse.get(key);
      if (existing) return existing;
      const idx = counters[type] ?? 0;
      counters[type] = idx + 1;
      const placeholder = `[${type}_${idx}]`;
      vault[placeholder] = match;
      reverse.set(key, placeholder);
      return placeholder;
    };
    let sanitized = message;
    for (const { regex, type } of PATTERNS) {
      sanitized = sanitized.replace(regex, (match) => getPlaceholder(type, match));
    }
    return { sanitized, vault };
  }
  /**
   * Restores placeholders to their original values. Sorts longest placeholder
   * first so [AMOUNT_10] is replaced before [AMOUNT_1] in case of overlap.
   */
  reidentify(response, vault) {
    const sorted = Object.keys(vault).sort((a, b) => b.length - a.length);
    let result = response;
    for (const placeholder of sorted) {
      result = result.split(placeholder).join(vault[placeholder]);
    }
    return result;
  }
};
var DEFAULT_MODEL = "claude-haiku-4-5-20251001";
var DEFAULT_MAX_TOKENS = 1024;
var ANTHROPIC_BASE = "https://api.anthropic.com";
var PQCLLMClient = class {
  constructor(config) {
    this.config = config;
  }
  config;
  pipeline = new DeidentificationPipeline();
  async *stream(messages, userContext) {
    let lastVault = {};
    const sanitizedMessages = messages.map((msg) => {
      if (msg.role === "user") {
        const { sanitized, vault } = this.pipeline.deidentify(msg.content, userContext);
        lastVault = vault;
        return { ...msg, content: sanitized };
      }
      return msg;
    });
    const baseUrl = this.config.proxyUrl || ANTHROPIC_BASE;
    const response = await fetch6(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: this.config.model ?? DEFAULT_MODEL,
        max_tokens: this.config.maxTokens ?? DEFAULT_MAX_TOKENS,
        stream: true,
        messages: sanitizedMessages
      })
    });
    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
    }
    const body = response.body;
    if (!body) return;
    let buffer = "";
    for await (const raw of body) {
      buffer += Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") return;
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta" && parsed.delta.text) {
            yield this.pipeline.reidentify(parsed.delta.text, lastVault);
          }
        } catch {
        }
      }
    }
  }
  async chat(messages, userContext) {
    let lastVault = {};
    const sanitizedMessages = messages.map((msg) => {
      if (msg.role === "user") {
        const { sanitized, vault } = this.pipeline.deidentify(msg.content, userContext);
        lastVault = vault;
        return { ...msg, content: sanitized };
      }
      return msg;
    });
    const baseUrl = this.config.proxyUrl || ANTHROPIC_BASE;
    const response = await fetch6(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: this.config.model ?? DEFAULT_MODEL,
        max_tokens: this.config.maxTokens ?? DEFAULT_MAX_TOKENS,
        messages: sanitizedMessages
      })
    });
    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    const rawResponse = data.content?.[0]?.text ?? "";
    void pqcTransport.seal({ sanitizedMessages, response: rawResponse, timestamp: Date.now() }, COORDINATOR_PUBLIC_KEY).catch(() => {
    });
    return this.pipeline.reidentify(rawResponse, lastVault);
  }
};

// src/data/seed.ts
var stepCounter = 0;
function step(partial) {
  return { index: stepCounter++, ...partial };
}
function resetSteps() {
  stepCounter = 0;
}
function ctx(address, balances, network = "base-sepolia") {
  return { address, network, balances };
}
function plan(steps, opts) {
  return {
    steps,
    estimatedGas: opts.estimatedGas ?? "0.45",
    estimatedOutcome: opts.estimatedOutcome ?? "",
    riskLevel: opts.riskLevel ?? "medium",
    warnings: opts.warnings ?? [],
    reasoning: opts.reasoning,
    requiresApproval: opts.requiresApproval ?? true,
    totalFees: opts.totalFees ?? "0.00",
    confidence: opts.confidence ?? 0.85
  };
}
var SEED_EXAMPLES = [];
resetSteps();
SEED_EXAMPLES.push({
  input: "Borrow USDC against my ETH, no more than 8% interest",
  context: ctx("0xAAA1", { ETH: "5" }),
  reasoning: [
    "Checking ETH balance: 5 = $15000.00",
    "Fetching Aave V3 ETH parameters on Base",
    "ETH LTV: 80% \u2192 theoretical max borrow = $12000.00",
    "Applying 80% safety buffer \u2192 safe borrow = $9600.00",
    "Constraint check: no more than 8% interest",
    "Current variable rate: 4.50% passes constraint",
    "Health factor at safe borrow: 1.56 (target > 1.5)"
  ],
  plan: plan(
    [
      step({ protocol: "aave", action: "approve", description: "Approve Aave to spend 5 ETH", params: { token: "ETH", amount: "5" }, estimatedGas: "0.15" }),
      step({ protocol: "aave", action: "supply", description: "Supply 5 ETH as collateral", params: { token: "ETH", amount: "5" }, estimatedGas: "0.15" }),
      step({ protocol: "aave", action: "borrow", description: "Borrow $9600.00 USDC against ETH", params: { collateralToken: "ETH", borrowUsd: "9600.00", rateMode: "variable" }, estimatedGas: "0.15" })
    ],
    { reasoning: [], estimatedOutcome: "Borrow up to $9600.00 USDC at 4.50% variable APY", riskLevel: "low", confidence: 0.88 }
  ),
  ghostResponse: "Understood, Sovereign. Analyzing loan parameters for your position.",
  warnings: []
});
resetSteps();
SEED_EXAMPLES.push({
  input: "I want to borrow against my WBTC, keep rate under 6%",
  context: ctx("0xAAA2", { WBTC: "0.5" }),
  reasoning: [
    "Checking WBTC balance: 0.5 = $30000.00",
    "Fetching Aave V3 WBTC parameters on Base",
    "WBTC LTV: 73% \u2192 theoretical max borrow = $21900.00",
    "Applying 80% safety buffer \u2192 safe borrow = $17520.00",
    "Constraint check: under 6%",
    "Current variable rate: 5.20% passes constraint",
    "Health factor at safe borrow: 1.71 (target > 1.5)"
  ],
  plan: plan(
    [
      step({ protocol: "aave", action: "approve", description: "Approve Aave to spend 0.5 WBTC", params: { token: "WBTC", amount: "0.5" }, estimatedGas: "0.12" }),
      step({ protocol: "aave", action: "supply", description: "Supply 0.5 WBTC as collateral", params: { token: "WBTC", amount: "0.5" }, estimatedGas: "0.12" }),
      step({ protocol: "aave", action: "borrow", description: "Borrow $17520.00 against WBTC", params: { collateralToken: "WBTC", borrowUsd: "17520.00", rateMode: "variable" }, estimatedGas: "0.12" })
    ],
    { reasoning: [], estimatedOutcome: "Borrow up to $17520.00 at 5.20% variable APY", riskLevel: "low", confidence: 0.86 }
  ),
  ghostResponse: "Understood, Sovereign. Analyzing loan parameters for your position.",
  warnings: []
});
resetSteps();
SEED_EXAMPLES.push({
  input: "Take out a loan against 50% of my USDC, max 4% rate",
  context: ctx("0xAAA3", { USDC: "10000" }),
  reasoning: [
    "Checking USDC balance: 5000 = $5000.00",
    "Fetching Aave V3 USDC parameters on Base",
    "USDC LTV: 77% \u2192 theoretical max borrow = $3850.00",
    "Applying 80% safety buffer \u2192 safe borrow = $3080.00",
    "Constraint check: max 4% rate",
    "Current variable rate: 5.00% fails constraint",
    "Current stable rate: 6.00% fails constraint"
  ],
  plan: plan(
    [
      step({ protocol: "aave", action: "approve", description: "Approve Aave to spend 5000 USDC", params: { token: "USDC", amount: "5000" }, estimatedGas: "0.10" }),
      step({ protocol: "aave", action: "supply", description: "Supply 5000 USDC as collateral", params: { token: "USDC", amount: "5000" }, estimatedGas: "0.10" }),
      step({ protocol: "aave", action: "borrow", description: "Borrow $3080.00 against USDC", params: { collateralToken: "USDC", borrowUsd: "3080.00", rateMode: "variable" }, estimatedGas: "0.10" })
    ],
    { reasoning: [], estimatedOutcome: "No Aave rate currently satisfies a 4% ceiling", riskLevel: "medium", confidence: 0.4 }
  ),
  ghostResponse: "Understood, Sovereign. Analyzing loan parameters for your position.",
  warnings: ['No Aave rate for USDC satisfies the constraint "max 4% rate"']
});
var aaveBorrowFillers = [
  ["Borrow against my ETH for a leveraged position", "ETH", "3"],
  ["Use my WBTC as collateral and borrow USDC", "WBTC", "0.2"],
  ["Open a loan with ETH collateral, keep it conservative", "ETH", "10"],
  ["Borrow the max safe amount against my USDC", "USDC", "20000"],
  ["I need a loan against my WBTC holdings", "WBTC", "1"],
  ["Take a small loan against ETH, no more than 7% interest", "ETH", "1"],
  ["Borrow USDC using my ETH as collateral, stable rate only", "ETH", "2"]
];
for (const [input, token, amount] of aaveBorrowFillers) {
  resetSteps();
  const balance = parseFloat(amount);
  const price = token === "ETH" ? 3e3 : token === "WBTC" ? 6e4 : 1;
  const usd = balance * price;
  const ltv = token === "ETH" ? 0.8 : token === "WBTC" ? 0.73 : 0.77;
  const safe = usd * ltv * 0.8;
  SEED_EXAMPLES.push({
    input,
    context: ctx("0xAAA" + Math.random().toString(16).slice(2, 6), { [token]: amount }),
    reasoning: [
      `Checking ${token} balance: ${amount} = $${usd.toFixed(2)}`,
      `Fetching Aave V3 ${token} parameters on Base`,
      `${token} LTV: ${(ltv * 100).toFixed(0)}% \u2192 theoretical max borrow = $${(usd * ltv).toFixed(2)}`,
      `Applying 80% safety buffer \u2192 safe borrow = $${safe.toFixed(2)}`,
      `Health factor at safe borrow: ${(1 / (ltv * 0.8)).toFixed(2)} (target > 1.5)`
    ],
    plan: plan(
      [
        step({ protocol: "aave", action: "approve", description: `Approve Aave to spend ${amount} ${token}`, params: { token, amount }, estimatedGas: "0.12" }),
        step({ protocol: "aave", action: "supply", description: `Supply ${amount} ${token} as collateral`, params: { token, amount }, estimatedGas: "0.12" }),
        step({ protocol: "aave", action: "borrow", description: `Borrow $${safe.toFixed(2)} against ${token}`, params: { collateralToken: token, borrowUsd: safe.toFixed(2), rateMode: "variable" }, estimatedGas: "0.12" })
      ],
      { reasoning: [], estimatedOutcome: `Borrow up to $${safe.toFixed(2)} against ${amount} ${token}`, riskLevel: "low", confidence: 0.85 }
    ),
    ghostResponse: "Understood, Sovereign. Analyzing loan parameters for your position.",
    warnings: []
  });
}
var yieldScenarios = [
  ["Where can I earn the best yield on my USDC?", "USDC", "5000", false],
  ["Find me the safest yield for my ETH, no impermanent loss", "ETH", "3", true],
  ["I want maximum yield on my AERO, risk it", "AERO", "10000", false],
  ["Earn interest on my idle USDC", "USDC", "2000", false],
  ["What is the best APY for my WBTC right now?", "WBTC", "0.3", false],
  ["Put my ETH to work earning yield conservatively", "ETH", "1", true],
  ["Maximize my AERO yield, I do not mind risk", "AERO", "5000", false],
  ["Find passive income for my USDC, low risk please", "USDC", "15000", true],
  ["Where should I stake my OCT for the best return?", "OCT", "8000", false],
  ["Optimize yield on my ETH and USDC", "ETH", "2", false]
];
for (const [input, token, amount, riskAverse] of yieldScenarios) {
  resetSteps();
  SEED_EXAMPLES.push({
    input,
    context: ctx("0xYLD" + Math.random().toString(16).slice(2, 6), { [token]: amount }),
    reasoning: [
      `Scanning Aave V3 supply APY for ${token}`,
      `Scanning Aerodrome pools for ${token}`,
      riskAverse ? "User requested low-risk yield \u2192 preferring Aave lending over LP" : "No risk preference stated \u2014 comparing APY across both venues"
    ],
    plan: plan(
      [
        step({
          protocol: riskAverse ? "aave" : "aerodrome",
          action: riskAverse ? "supply" : "provide_liquidity",
          description: riskAverse ? `Supply ${amount} ${token} to Aave V3` : `Provide ${amount} ${token} to the highest-APR Aerodrome pool`,
          params: { token, amount },
          estimatedGas: "0.10"
        })
      ],
      { reasoning: [], estimatedOutcome: riskAverse ? "Earn Aave supply APY with no IL risk" : "Earn the highest available APR", riskLevel: riskAverse ? "low" : "medium", confidence: 0.8 }
    ),
    ghostResponse: "Understood, Sovereign. Scanning the market for the best yield on your assets.",
    warnings: riskAverse ? [] : ["No risk preference stated \u2014 defaulted to the higher-yield option. Impermanent loss applies to LP positions."]
  });
}
var rebalanceScenarios = [
  ["Rebalance my portfolio to 50% ETH and 50% USDC", { ETH: "2", USDC: "1000" }],
  ["Rebalance to 70% USDC and 30% ETH", { ETH: "3", USDC: "2000" }],
  ["I want 40% ETH, 40% USDC, 20% WBTC allocation", { ETH: "1", USDC: "500", WBTC: "0.05" }],
  ["Rebalance everything to 100% USDC", { ETH: "2", USDC: "0" }],
  ["Set my allocation to 60% ETH and 40% AERO", { ETH: "2", AERO: "1000" }],
  ["Rebalance to 25% ETH, 25% WBTC, 50% USDC", { ETH: "1", WBTC: "0.1", USDC: "3000" }],
  ["I want an even 50/50 split of ETH and WBTC, 50% ETH 50% WBTC", { ETH: "4", WBTC: "0.05" }],
  ["Rebalance my OCT and USDC holdings to 30% OCT 70% USDC", { OCT: "5000", USDC: "1000" }],
  ["Shift my portfolio to 80% USDC and 20% ETH for safety", { ETH: "3", USDC: "500" }],
  ["Rebalance to 33% ETH 33% USDC 34% AERO", { ETH: "1", USDC: "1000", AERO: "2000" }]
];
for (const [input, balances] of rebalanceScenarios) {
  resetSteps();
  SEED_EXAMPLES.push({
    input,
    context: ctx("0xREB" + Math.random().toString(16).slice(2, 6), balances),
    reasoning: [
      "Parsed target allocations from instruction",
      "Calculated current portfolio value across all held assets",
      "Determined required buy/sell amounts to hit target weights",
      "Ordering sells before buys to minimize gas and avoid temporary undercollateralization"
    ],
    plan: plan(
      [
        step({ protocol: "uniswap", action: "sell", description: "Sell overweight asset toward target allocation", params: {}, estimatedGas: "0.10" }),
        step({ protocol: "uniswap", action: "buy", description: "Buy underweight asset toward target allocation", params: {}, estimatedGas: "0.10" })
      ],
      { reasoning: [], estimatedOutcome: "Portfolio rebalanced to target allocation", riskLevel: "medium", confidence: 0.75 }
    ),
    ghostResponse: "Understood, Sovereign. Reasoning through your request...",
    warnings: []
  });
}
var complexScenarios = [
  "Swap half my ETH for USDC on Uniswap, only if gas is under $5",
  "Borrow USDC against ETH and immediately provide it as liquidity on Aerodrome",
  "Bridge my USDC to Base and then supply it to Aave, as long as the bridge fee is under 1%",
  "Sell my WBTC for ETH on Uniswap unless the price impact exceeds 2%",
  "Move my idle USDC into the best Aerodrome pool, only if APR is above 10%",
  "Borrow against my WBTC and use the proceeds to buy more ETH, no more than 6% interest",
  "Provide liquidity on Aerodrome with my ETH and USDC, as long as IL risk is acceptable",
  "Repay my Aave loan using USDC from my wallet, only if my health factor is above 2",
  "Swap my AERO for USDC on Uniswap unless slippage exceeds 1%",
  "Bridge ETH to Base then swap it for USDC on Uniswap, only if total fees stay under $10"
];
for (const input of complexScenarios) {
  resetSteps();
  SEED_EXAMPLES.push({
    input,
    context: ctx("0xCPX" + Math.random().toString(16).slice(2, 6), { ETH: "2", USDC: "3000", WBTC: "0.1", AERO: "1000" }),
    reasoning: [
      "Detected a named protocol combined with a free-text constraint \u2014 escalating to full reasoning",
      "Building a generic plan; specialized multi-step reasoning to follow as protocol coverage expands"
    ],
    plan: plan(
      [
        step({ protocol: "unknown", action: "complex", description: "Execute complex as requested", params: {}, estimatedGas: "0.10" })
      ],
      { reasoning: [], estimatedOutcome: "Generic execution of complex", riskLevel: "medium", confidence: 0.5 }
    ),
    ghostResponse: "Understood, Sovereign. Reasoning through your request...",
    warnings: []
  });
}
resetSteps();
SEED_EXAMPLES.push({
  input: "Swap 100 ETH for USDC",
  context: ctx("0xEDGE1", { ETH: "1" }),
  reasoning: ["Verifying ETH balance: have 1, need 100"],
  plan: plan(
    [step({ protocol: "uniswap", action: "swap", description: "Swap 100 ETH for USDC", params: { fromToken: "ETH", toToken: "USDC", amount: "100" }, estimatedGas: "0.10" })],
    { reasoning: [], estimatedOutcome: "Receive approximately 0 USDC", riskLevel: "low", confidence: 0.3 }
  ),
  ghostResponse: "Understood, Sovereign. Preparing to swap 100 ETH to USDC.",
  warnings: ["Insufficient ETH balance: requested 100, available 1"]
});
resetSteps();
SEED_EXAMPLES.push({
  input: "Borrow USDC against ETH, no more than 0.1% interest",
  context: ctx("0xEDGE2", { ETH: "5" }),
  reasoning: [
    "Checking ETH balance: 5 = $15000.00",
    "Constraint check: no more than 0.1% interest",
    "Current variable rate: 4.50% fails constraint",
    "Current stable rate: 6.00% fails constraint"
  ],
  plan: plan(
    [step({ protocol: "aave", action: "borrow", description: "Borrow against ETH collateral", params: { collateralToken: "ETH" }, estimatedGas: "0.10" })],
    { reasoning: [], estimatedOutcome: "No Aave rate satisfies a 0.1% ceiling", riskLevel: "medium", confidence: 0.4 }
  ),
  ghostResponse: "Understood, Sovereign. Analyzing loan parameters for your position.",
  warnings: ['No Aave rate for ETH satisfies the constraint "no more than 0.1% interest"']
});
resetSteps();
SEED_EXAMPLES.push({
  input: "Borrow 90% of the max against my entire ETH stack",
  context: ctx("0xEDGE3", { ETH: "20" }),
  reasoning: [
    "Checking ETH balance: 20 = $60000.00",
    "ETH LTV: 80% \u2192 theoretical max borrow = $48000.00",
    "Applying 80% safety buffer \u2192 safe borrow = $38400.00",
    "Health factor at safe borrow: 1.56 (target > 1.5)"
  ],
  plan: plan(
    [step({ protocol: "aave", action: "borrow", description: "Borrow against full ETH stack", params: { collateralToken: "ETH" }, estimatedGas: "0.10" })],
    { reasoning: [], estimatedOutcome: "Borrow up to $38400.00", riskLevel: "medium", confidence: 0.78 }
  ),
  ghostResponse: "Understood, Sovereign. Analyzing loan parameters for your position.",
  warnings: ["Health factor (1.56) is below 2.0 \u2014 consider borrowing less for extra safety margin."]
});
resetSteps();
SEED_EXAMPLES.push({
  input: "Earn yield on my WELL tokens",
  context: ctx("0xEDGE4", { WELL: "10000" }),
  reasoning: ["Scanning Aave V3 supply APY for WELL: unavailable", "Scanning Aerodrome pools for WELL: no pool found"],
  plan: plan([], { reasoning: [], estimatedOutcome: "No yield data available", riskLevel: "low", requiresApproval: false, confidence: 0.3 }),
  ghostResponse: "Understood, Sovereign. Scanning the market for the best yield on your assets.",
  warnings: ["Sovereign, no yield data is currently available for this asset."]
});
resetSteps();
SEED_EXAMPLES.push({
  input: "swap",
  context: ctx("0xEDGE5", { ETH: "1" }),
  reasoning: ["Input too sparse to extract token or amount parameters"],
  plan: plan([], { reasoning: [], estimatedOutcome: "Awaiting clarification", riskLevel: "low", requiresApproval: false, confidence: 0.3 }),
  ghostResponse: "Sovereign, could you clarify what action you would like Ghost to take?",
  warnings: []
});
resetSteps();
SEED_EXAMPLES.push({
  input: "do the thing with my money",
  context: ctx("0xEDGE6", { USDC: "1000" }),
  reasoning: ["No recognizable DeFi action keyword found in instruction"],
  plan: plan([], { reasoning: [], estimatedOutcome: "Awaiting clarification", riskLevel: "low", requiresApproval: false, confidence: 0.3 }),
  ghostResponse: "Sovereign, could you clarify what action you would like Ghost to take?",
  warnings: []
});
resetSteps();
SEED_EXAMPLES.push({
  input: "Rebalance my portfolio",
  context: ctx("0xEDGE7", { ETH: "2", USDC: "1000" }),
  reasoning: ["Parsed target allocations from instruction: none found"],
  plan: plan([], { reasoning: [], estimatedOutcome: "No rebalance performed \u2014 target allocation unclear", riskLevel: "low", requiresApproval: false, confidence: 0.3 }),
  ghostResponse: "Understood, Sovereign. Reasoning through your request...",
  warnings: ["Sovereign, no explicit target allocation was found \u2014 please specify percentages per asset."]
});
resetSteps();
SEED_EXAMPLES.push({
  input: "Swap 5 ETH for USDC, slippage no more than 0.1%",
  context: ctx("0xEDGE8", { ETH: "10" }),
  reasoning: ["Verifying ETH balance: have 10, need 5", "Uniswap quote price impact exceeds 0.1% slippage tolerance"],
  plan: plan(
    [step({ protocol: "uniswap", action: "swap", description: "Swap 5 ETH for USDC", params: { fromToken: "ETH", toToken: "USDC", amount: "5" }, estimatedGas: "0.10" })],
    { reasoning: [], estimatedOutcome: "Receive approximately the quoted USDC amount", riskLevel: "medium", confidence: 0.9 }
  ),
  ghostResponse: "Understood, Sovereign. Preparing to swap 5 ETH to USDC.",
  warnings: ["Price impact exceeds your slippage tolerance of 0.10%"]
});
resetSteps();
SEED_EXAMPLES.push({
  input: "Borrow against my CBETH",
  context: ctx("0xEDGE9", { CBETH: "2" }),
  reasoning: ["Checking CBETH balance: 2 = $2.00", "No Aave market data for CBETH \u2014 falling back to conservative USDC parameters"],
  plan: plan(
    [step({ protocol: "aave", action: "borrow", description: "Borrow against CBETH collateral", params: { collateralToken: "CBETH" }, estimatedGas: "0.10" })],
    { reasoning: [], estimatedOutcome: "Borrow using fallback collateral parameters", riskLevel: "medium", confidence: 0.6 }
  ),
  ghostResponse: "Understood, Sovereign. Analyzing loan parameters for your position.",
  warnings: []
});
resetSteps();
SEED_EXAMPLES.push({
  input: "Provide liquidity with my entire portfolio",
  context: ctx("0xEDGE10", { ETH: "1", USDC: "500" }),
  reasoning: ["Detected liquidity provision request without a named pool \u2014 escalating for clarification on pair selection"],
  plan: plan([], { reasoning: [], estimatedOutcome: "Awaiting pool selection", riskLevel: "low", requiresApproval: false, confidence: 0.4 }),
  ghostResponse: "Understood, Sovereign. Evaluating liquidity provision for the requested pair.",
  warnings: ["Sovereign, which pool would you like to provide liquidity to?"]
});
var USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
var USDC_DECIMALS = 6;
async function fetchBalances(address, rpcUrl) {
  const client = createPublicClient({
    chain: base,
    transport: http(rpcUrl)
  });
  const addr = address;
  const [ethWei, usdcRaw] = await Promise.all([
    client.getBalance({ address: addr }),
    client.readContract({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [addr]
    })
  ]);
  return {
    ETH: formatEther(ethWei),
    USDC: formatUnits(usdcRaw, USDC_DECIMALS)
  };
}

export { COORDINATOR_PUBLIC_KEY, DeFiReasoner, DeidentificationPipeline, FederatedCoordinator, Ghost, GhostTrainer, IntentParser, KNOWN_TOKENS2 as KNOWN_TOKENS, OCTRA_NODE_PUBKEY, PQCLLMClient, PQCTransport, SEED_EXAMPLES, TrainingScheduler, fetchBalances, getAuditLog, pqcTransport };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map