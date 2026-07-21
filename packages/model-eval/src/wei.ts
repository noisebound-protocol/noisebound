import { ethToWei as ethToWeiBigint } from '@noisebound/sigma-core';

/**
 * Converts a decimal ETH amount to a wei string using exact integer/string
 * arithmetic (never a float), so amounts like "0.0001" or "0.001" convert
 * without the rounding error a naive `Number(eth) * 1e18` would introduce.
 * Thin string-returning wrapper around sigma-core's `ethToWei` — the eval
 * harness scores against the same conversion the real system trusts,
 * rather than a second, independently-maintained implementation.
 */
export function ethToWei(eth: string): string {
  return ethToWeiBigint(eth).toString();
}
