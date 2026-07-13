import fetch from 'node-fetch';

const BASE_GAS_URL = 'https://api.basescan.org/api?module=gastracker&action=gasoracle';
const FETCH_TIMEOUT_MS = 6_000;
const FALLBACK_GAS_GWEI = '0.05';
const ETH_USD_ESTIMATE = 3_000;

/**
 * Fetches current Base gas price and estimates transaction costs.
 * Falls back to a conservative flat estimate when the gas API is unreachable.
 */
export class GasFetcher {
  async getGasPrice(_network: string): Promise<string> {
    try {
      const res = await fetchWithTimeout(BASE_GAS_URL, FETCH_TIMEOUT_MS);
      if (!res.ok) throw new Error(`Gas API responded ${res.status}`);
      const data = (await res.json()) as { result?: { SafeGasPrice?: string } };
      return data.result?.SafeGasPrice ?? FALLBACK_GAS_GWEI;
    } catch {
      return FALLBACK_GAS_GWEI;
    }
  }

  async estimateGasCost(steps: number, network: string): Promise<string> {
    const gweiStr = await this.getGasPrice(network);
    const gwei = parseFloat(gweiStr) || parseFloat(FALLBACK_GAS_GWEI);
    const gasUnitsPerStep = 150_000;
    const totalGasUnits = gasUnitsPerStep * Math.max(1, steps);
    const ethCost = (gwei * 1e-9) * totalGasUnits;
    const usdCost = ethCost * ETH_USD_ESTIMATE;
    return usdCost.toFixed(2);
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
