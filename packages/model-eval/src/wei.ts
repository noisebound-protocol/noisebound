/**
 * Converts a decimal ETH amount to a wei string using exact integer/string
 * arithmetic (never a float), so amounts like "0.0001" or "0.001" convert
 * without the rounding error a naive `Number(eth) * 1e18` would introduce.
 */
export function ethToWei(eth: string): string {
  const trimmed = eth.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`ethToWei: not a plain decimal amount: ${eth}`);
  }

  const [wholePart = '0', fracPart = ''] = trimmed.split('.');
  if (fracPart.length > 18) {
    throw new Error(`ethToWei: more than 18 fractional digits: ${eth}`);
  }

  const fracPadded = fracPart.padEnd(18, '0');
  const wei = BigInt(wholePart) * 1_000_000_000_000_000_000n + BigInt(fracPadded);
  return wei.toString();
}
