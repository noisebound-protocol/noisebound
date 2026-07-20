import type { ActionRequest } from './types.js';

function truncateAddress(address: string): string {
  return `${address.slice(0, 5)}...${address.slice(-3)}`;
}

/**
 * Formats a wei amount as a decimal ETH string, trimming trailing fractional
 * zeros. Unlike a cents-based amount, this never loses precision for small
 * transfers (e.g. 0.001 ETH), since wei is the source of truth for on-chain
 * money requests.
 */
function formatWeiAmount(wei: bigint): string {
  const negative = wei < 0n;
  const abs = negative ? -wei : wei;
  const whole = abs / 1_000_000_000_000_000_000n;
  const fraction = abs % 1_000_000_000_000_000_000n;
  const fractionStr = fraction.toString().padStart(18, '0').replace(/0+$/, '');
  const sign = negative ? '-' : '';
  return fractionStr ? `${sign}${whole}.${fractionStr}` : `${sign}${whole}`;
}

/** Builds the real, human-readable confirmation text a UI shows before executing an action. */
export function buildConfirmationSummary(request: ActionRequest): string {
  switch (request.kind) {
    case 'on-chain-money':
      return `Send ${formatWeiAmount(request.amountWei)} ${request.asset} to ${truncateAddress(request.recipient)}`;
    case 'cloud-inference':
      return `Run cloud inference request "${request.description}"`;
  }
}
