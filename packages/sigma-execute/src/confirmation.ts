import type { ActionRequest } from './types.js';

function truncateAddress(address: string): string {
  return `${address.slice(0, 5)}...${address.slice(-3)}`;
}

function formatMoney(amountCents: number, currency: string): string {
  const amount = (amountCents / 100).toLocaleString('en-US', {
    minimumFractionDigits: amountCents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return currency === 'USD' ? `$${amount}` : `${amount} ${currency}`;
}

/** Builds the real, human-readable confirmation text a UI shows before executing an action. */
export function buildConfirmationSummary(request: ActionRequest): string {
  switch (request.kind) {
    case 'on-chain-money':
      return `Send ${formatMoney(request.amountCents, request.currency)} (${request.asset}) to ${truncateAddress(request.recipient)}`;
    case 'cloud-inference':
      return `Run cloud inference request "${request.description}"`;
  }
}
