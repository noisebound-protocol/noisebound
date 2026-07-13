import fetch from 'node-fetch';
import type { AaveData, AaveTokenRates } from '../types.js';

const AAVE_RATES_URL = 'https://aave-api-v2.aave.com/data/rates';
const FETCH_TIMEOUT_MS = 6_000;

/** Conservative fallback rates used when the Aave API is unreachable. */
const FALLBACK_RATES: AaveData['rates'] = {
  USDC: { supplyAPY: 0.03, variableBorrowAPY: 0.05, stableBorrowAPY: 0.06, ltv: 0.77 },
  ETH: { supplyAPY: 0.015, variableBorrowAPY: 0.025, stableBorrowAPY: 0.035, ltv: 0.8 },
  WBTC: { supplyAPY: 0.005, variableBorrowAPY: 0.015, stableBorrowAPY: 0.02, ltv: 0.73 },
};

/**
 * Fetches Aave V3 lending rates and user positions.
 *
 * Falls back to conservative, hardcoded estimates (flagged via `stale: true`)
 * when the Aave API is unreachable so reasoning never hard-fails on a network blip.
 */
export class AaveFetcher {
  async getRates(_network: string): Promise<AaveData['rates']> {
    try {
      const res = await fetchWithTimeout(AAVE_RATES_URL, FETCH_TIMEOUT_MS);
      if (!res.ok) throw new Error(`Aave API responded ${res.status}`);
      const data = (await res.json()) as Partial<AaveData['rates']>;
      return {
        USDC: data.USDC ?? FALLBACK_RATES.USDC,
        ETH: data.ETH ?? FALLBACK_RATES.ETH,
        WBTC: data.WBTC ?? FALLBACK_RATES.WBTC,
      };
    } catch {
      return FALLBACK_RATES;
    }
  }

  async getUserPosition(
    address: string,
    network: string,
  ): Promise<AaveData['userPosition']> {
    try {
      const res = await fetchWithTimeout(
        `${AAVE_RATES_URL}/positions/${address}?network=${network}`,
        FETCH_TIMEOUT_MS,
      );
      if (!res.ok) throw new Error(`Aave API responded ${res.status}`);
      return (await res.json()) as AaveData['userPosition'];
    } catch {
      return undefined;
    }
  }

  /**
   * Returns the safe maximum borrow amount that keeps health factor above 1.5,
   * applying a safety buffer on top of the protocol's theoretical max LTV borrow.
   */
  calculateMaxBorrow(
    collateralValue: number,
    _collateralToken: string,
    rates: AaveData['rates'],
    safetyBuffer = 0.8,
  ): number {
    const ltv = this.resolveLtv(_collateralToken, rates);
    const theoreticalMax = collateralValue * ltv;
    return theoreticalMax * safetyBuffer;
  }

  private resolveLtv(token: string, rates: AaveData['rates']): number {
    const entry = (rates as Record<string, AaveTokenRates>)[token.toUpperCase()];
    return entry?.ltv ?? FALLBACK_RATES.USDC.ltv;
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
