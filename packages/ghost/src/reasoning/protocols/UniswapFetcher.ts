import fetch from 'node-fetch';
import type { UniswapQuote } from '../types.js';

const UNISWAP_QUOTE_URL = 'https://interface.gateway.uniswap.org/v2/quote';
const COINGECKO_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price';
const FETCH_TIMEOUT_MS = 6_000;

const COINGECKO_IDS: Record<string, string> = {
  ETH: 'ethereum',
  WETH: 'ethereum',
  WBTC: 'wrapped-bitcoin',
  CBBTC: 'wrapped-bitcoin',
  USDC: 'usd-coin',
  USDT: 'tether',
  DAI: 'dai',
  OCT: 'octra',
  AERO: 'aerodrome-finance',
};

/**
 * Fetches Uniswap V3 swap quotes on Base.
 *
 * Falls back to a CoinGecko price-ratio estimate (flagged `estimated: true`)
 * when the Uniswap quoting API is unreachable.
 */
export class UniswapFetcher {
  async getQuote(
    fromToken: string,
    toToken: string,
    amount: string,
    network: string,
  ): Promise<UniswapQuote> {
    try {
      const res = await fetchWithTimeout(
        `${UNISWAP_QUOTE_URL}?tokenIn=${fromToken}&tokenOut=${toToken}&amount=${amount}&network=${network}`,
        FETCH_TIMEOUT_MS,
      );
      if (!res.ok) throw new Error(`Uniswap quote API responded ${res.status}`);
      const data = (await res.json()) as Partial<UniswapQuote>;
      return {
        amountOut: data.amountOut ?? '0',
        priceImpact: data.priceImpact ?? 0,
        route: data.route ?? [fromToken, toToken],
      };
    } catch {
      return this.estimateFromCoingecko(fromToken, toToken, amount);
    }
  }

  private async estimateFromCoingecko(
    fromToken: string,
    toToken: string,
    amount: string,
  ): Promise<UniswapQuote> {
    const fromId = COINGECKO_IDS[fromToken.toUpperCase()];
    const toId = COINGECKO_IDS[toToken.toUpperCase()];
    if (!fromId || !toId) {
      return { amountOut: '0', priceImpact: 0, route: [fromToken, toToken], estimated: true };
    }
    try {
      const res = await fetchWithTimeout(
        `${COINGECKO_PRICE_URL}?ids=${fromId},${toId}&vs_currencies=usd`,
        FETCH_TIMEOUT_MS,
      );
      if (!res.ok) throw new Error(`CoinGecko responded ${res.status}`);
      const prices = (await res.json()) as Record<string, { usd: number }>;
      const fromUsd = prices[fromId]?.usd;
      const toUsd = prices[toId]?.usd;
      if (!fromUsd || !toUsd) throw new Error('CoinGecko missing price data');
      const amountOut = ((parseFloat(amount) || 0) * fromUsd) / toUsd;
      return {
        amountOut: amountOut.toString(),
        priceImpact: 0.003,
        route: [fromToken, toToken],
        estimated: true,
      };
    } catch {
      return { amountOut: '0', priceImpact: 0, route: [fromToken, toToken], estimated: true };
    }
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
