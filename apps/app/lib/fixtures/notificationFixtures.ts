import type { NotificationEvent } from '@noisebound/sigma-core';

/**
 * DEVELOPMENT FIXTURE — demo notification events standing in for events the
 * running σ-1 agent would emit as it acts. Order is oldest-first.
 */
export interface NotificationFixtureItem extends NotificationEvent {
  readonly headline: string;
  readonly detail: string;
  readonly timestamp: number;
}

const now = Date.now();
const MIN = 60_000;

export const NOTIFICATION_FIXTURES: readonly NotificationFixtureItem[] = [
  {
    id: 'evt-1',
    kind: 'inaction-costs-money',
    headline: 'Session key allowance expires in 10 minutes',
    detail: 'Renew the trading session key or pending orders will stop executing.',
    timestamp: now - 4 * MIN,
  },
  {
    id: 'evt-2',
    kind: 'market-move-on-held-position',
    headline: 'ETH is down 6.2% in the last hour',
    detail: 'Held position affected: 0.5 ETH.',
    timestamp: now - 22 * MIN,
  },
  {
    id: 'evt-3',
    kind: 'matched-interest-opportunity',
    headline: 'New yield opportunity matches your stated interest',
    detail: 'A base-sepolia lending market is offering 4.1% APY on USDC.',
    timestamp: now - 51 * MIN,
  },
  {
    id: 'evt-4',
    kind: 'digest-item',
    headline: 'Gas prices dipped briefly on Base',
    detail: 'No action needed — folded into today’s digest.',
    timestamp: now - 70 * MIN,
  },
  {
    id: 'evt-5',
    kind: 'digest-item',
    headline: 'A watched contract emitted a routine event',
    detail: 'No action needed — folded into today’s digest.',
    timestamp: now - 95 * MIN,
  },
  {
    id: 'evt-6',
    kind: 'digest-item',
    headline: 'Session key #2 rotated automatically',
    detail: 'No action needed — folded into today’s digest.',
    timestamp: now - 130 * MIN,
  },
  {
    id: 'evt-7',
    kind: 'inaction-costs-money',
    headline: 'Approval for USDC spend expires tonight',
    detail: 'Re-approve before midnight to avoid a failed scheduled swap.',
    timestamp: now - 150 * MIN,
  },
];
