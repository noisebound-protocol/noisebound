export function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 5)}...${address.slice(-4)}`;
}

export function formatWeiAsEth(wei: bigint, fractionDigits = 4): string {
  const negative = wei < 0n;
  const abs = negative ? -wei : wei;
  const whole = abs / 1_000_000_000_000_000_000n;
  const fraction = abs % 1_000_000_000_000_000_000n;
  const fractionStr = fraction.toString().padStart(18, '0').slice(0, fractionDigits);
  const sign = negative ? '-' : '';
  return `${sign}${whole.toString()}.${fractionStr}`;
}

export function formatUnits(raw: bigint, decimals: number, fractionDigits = 2): string {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = abs % base;
  const fractionStr = fraction.toString().padStart(decimals, '0').slice(0, fractionDigits);
  const sign = negative ? '-' : '';
  return `${sign}${whole.toString()}.${fractionStr}`;
}

export function formatCentsAsCurrency(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

/** Formats cents as the plain decimal string a user must retype to arm a secondary confirmation, e.g. 34000 -> "340.00". */
export function formatExpectedAmount(amountCents: number): string {
  return (amountCents / 100).toFixed(2);
}

export function formatTimestamp(ms: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(ms));
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

export function msUntil(timestampMs: number, nowMs: number): number {
  return timestampMs - nowMs;
}

/** Parses a decimal ETH amount string (e.g. "0.05") into wei. Throws on malformed input. */
export function parseEthToWei(value: string): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`"${value}" is not a valid decimal amount`);
  }
  const [wholePart, fractionPart = ''] = trimmed.split('.');
  const fractionPadded = fractionPart.padEnd(18, '0').slice(0, 18);
  return BigInt(wholePart || '0') * 1_000_000_000_000_000_000n + BigInt(fractionPadded || '0');
}
