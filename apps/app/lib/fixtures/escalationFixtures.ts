import type { EscalationRequest } from '@noisebound/sigma-core';
import type { EscalationDataDisclosureItem } from '../types';

/**
 * DEVELOPMENT FIXTURE — demo escalation scenarios standing in for requests
 * that would, in production, be raised by the running σ-1 agent itself.
 */
export interface EscalationScenario {
  readonly id: string;
  readonly request: EscalationRequest;
  readonly dataDisclosure: readonly EscalationDataDisclosureItem[];
  /** The real-data confirmation label — omitted for hard-denied money requests. */
  readonly actionText?: string | undefined;
}

export const ESCALATION_SCENARIOS: readonly EscalationScenario[] = [
  {
    id: 'wire-transfer',
    request: {
      id: 'esc-money-1',
      category: 'money',
      description: 'Wire $340.00 to an external bank account to settle an invoice',
      amountCents: 34000,
      currency: 'USD',
    },
    dataDisclosure: [
      { label: 'Amount', value: '$340.00 USD' },
      { label: 'Destination', value: 'External bank account ····4471' },
      { label: 'Reason', value: 'Invoice #A-2291 settlement' },
    ],
    actionText: 'Send $340 to 0x4f2...9a1',
  },
  {
    id: 'large-wire-transfer',
    request: {
      id: 'esc-money-2',
      category: 'money',
      description: 'Wire $5,000.00 to an external bank account, above the session spend limit',
      amountCents: 500_000,
      currency: 'USD',
      amountWei: 2_000_000_000_000_000_000n,
    },
    dataDisclosure: [
      { label: 'Amount', value: '$5,000.00 USD' },
      { label: 'Destination', value: 'External bank account ····9a1' },
      { label: 'Reason', value: 'Vendor settlement above spend-limit threshold' },
    ],
    actionText: 'Send $5,000 to 0x4f2...9a1',
  },
  {
    id: 'swap-tokens',
    request: {
      id: 'esc-swap-1',
      category: 'irreversible-action',
      description: 'Swap 0.5 ETH for USDC using the session key allowance',
      requiresDisclosure: true,
    },
    dataDisclosure: [
      { label: 'From', value: '0.5 ETH' },
      { label: 'To', value: '~1,340 USDC (est.)' },
      { label: 'Router', value: '0x4f2d1a8c9b3e7f6021a5c8d9e0b1f2a3c4d5e6f7' },
      { label: 'Slippage tolerance', value: '0.5%' },
    ],
    actionText: 'Swap 0.5 ETH for USDC via 0x4f2...6f7',
  },
  {
    id: 'share-portfolio',
    request: {
      id: 'esc-data-1',
      category: 'data-sharing',
      description: 'Share a portfolio snapshot with a price-alert service',
      requiresDisclosure: true,
    },
    dataDisclosure: [
      { label: 'Recipient', value: 'alerts.pricewatch.xyz' },
      { label: 'Data shared', value: 'Token balances, no transaction history' },
      { label: 'Retention', value: 'Session-only, not stored' },
    ],
    actionText: 'Share portfolio snapshot with alerts.pricewatch.xyz',
  },
  {
    id: 'check-gas-price',
    request: {
      id: 'esc-api-1',
      category: 'external-api',
      description: 'Query current gas prices from a public RPC endpoint',
      requiresDisclosure: false,
    },
    dataDisclosure: [{ label: 'Data shared', value: 'None — public read-only query' }],
  },
];
