/**
 * The one trusted decimal-ETH-to-wei conversion in the codebase. Any
 * money-action amount that originates from an LLM/agent-facing boundary
 * must be a decimal string (e.g. "0.001") and must pass through this
 * function — never through model-produced wei arithmetic — before it
 * reaches escalation or execution logic. Uses exact bigint/string
 * arithmetic throughout; no floating-point operation is ever involved, so
 * there is no rounding drift for small or long-tailed amounts.
 */

const WEI_PER_ETH = 1_000_000_000_000_000_000n;

const DECIMAL_AMOUNT_PATTERN = /^\d+(\.\d+)?$/;

/**
 * Converts a plain decimal ETH amount (e.g. "0.001", "2.5", "10") to wei as
 * a bigint. Throws on anything that isn't a plain non-negative decimal
 * string — no scientific notation, no signs, no thousands separators — and
 * on more than 18 fractional digits, since wei is ETH's smallest unit.
 */
export function ethToWei(eth: string): bigint {
  const trimmed = eth.trim();
  if (!DECIMAL_AMOUNT_PATTERN.test(trimmed)) {
    throw new Error(`ethToWei: not a plain decimal amount: ${JSON.stringify(eth)}`);
  }

  const [wholePart = '0', fracPart = ''] = trimmed.split('.');
  if (fracPart.length > 18) {
    throw new Error(`ethToWei: more than 18 fractional digits: ${JSON.stringify(eth)}`);
  }

  const fracPadded = fracPart.padEnd(18, '0');
  return BigInt(wholePart) * WEI_PER_ETH + BigInt(fracPadded);
}

