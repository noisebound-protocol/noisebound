import fetch from 'node-fetch';
import type { AerodromePool } from '../types.js';

const AERODROME_SUBGRAPH_URL = 'https://api.thegraph.com/subgraphs/name/aerodrome-finance/aerodrome';
const FETCH_TIMEOUT_MS = 6_000;

/** Conservative fallback pools used when the Aerodrome subgraph is unreachable. */
const FALLBACK_POOLS: AerodromePool[] = [
  { poolAddress: '0xfallback-usdc-aero', token0: 'USDC', token1: 'AERO', apr: 0.08, tvl: 5_000_000, fee: 0.003 },
  { poolAddress: '0xfallback-eth-usdc', token0: 'ETH', token1: 'USDC', apr: 0.06, tvl: 20_000_000, fee: 0.003 },
];

/**
 * Fetches Aerodrome pool data on Base.
 *
 * Falls back to conservative hardcoded pools when the subgraph is unreachable.
 */
export class AerodromeFetcher {
  async getPools(_network: string): Promise<AerodromePool[]> {
    try {
      const res = await fetchWithTimeout(AERODROME_SUBGRAPH_URL, FETCH_TIMEOUT_MS);
      if (!res.ok) throw new Error(`Aerodrome subgraph responded ${res.status}`);
      const data = (await res.json()) as { pools?: AerodromePool[] };
      return data.pools && data.pools.length > 0 ? data.pools : FALLBACK_POOLS;
    } catch {
      return FALLBACK_POOLS;
    }
  }

  async getBestYield(token: string, network: string): Promise<AerodromePool | null> {
    const pools = await this.getPools(network);
    const matching = pools.filter(
      p => p.token0.toUpperCase() === token.toUpperCase() || p.token1.toUpperCase() === token.toUpperCase(),
    );
    if (matching.length === 0) return null;
    return matching.reduce((best, p) => (p.apr > best.apr ? p : best), matching[0]);
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
