import type { Clock } from './clock.js';

/**
 * Notification tiers:
 * - `tier-1`: inaction costs the user money. Always fires; does not count
 *   against the daily budget.
 * - `tier-2`: market moves on held positions, or opportunities matching a
 *   stated interest. Fires only if the daily budget allows.
 * - `tier-3`: everything else. Never pushed; folded into a digest instead.
 */
export type NotificationTier = 'tier-1' | 'tier-2' | 'tier-3';

export type NotificationEventKind =
  | 'inaction-costs-money'
  | 'market-move-on-held-position'
  | 'matched-interest-opportunity'
  | 'digest-item';

export interface NotificationEvent {
  readonly id: string;
  readonly kind: NotificationEventKind;
}

const TIER_BY_KIND: Readonly<Record<NotificationEventKind, NotificationTier>> = {
  'inaction-costs-money': 'tier-1',
  'market-move-on-held-position': 'tier-2',
  'matched-interest-opportunity': 'tier-2',
  'digest-item': 'tier-3',
};

/** Classifies a notification event into its push tier. */
export function classifyNotification(event: NotificationEvent): NotificationTier {
  return TIER_BY_KIND[event.kind];
}

export type NotificationOutcome = 'sent' | 'suppressed';

export interface NotificationBudgetOptions {
  /** Maximum number of tier-2 pushes allowed per day. Intended range: 3-5. */
  readonly dailyLimit: number;
  readonly clock: Clock;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Tracks the daily tier-2 notification budget.
 *
 * Tier 1 always sends and never touches the count. Tier 2 sends decrement
 * the remaining budget and are suppressed once it is exhausted. Tier 3 is
 * always suppressed and only increments the suppressed counter (for digest
 * purposes). The budget resets automatically when the clock crosses into a
 * new UTC day.
 */
export class NotificationBudget {
  private readonly dailyLimit: number;
  private readonly clock: Clock;
  private count = 0;
  private suppressedTier3Count = 0;
  private currentDay: string;

  constructor(options: NotificationBudgetOptions) {
    this.dailyLimit = options.dailyLimit;
    this.clock = options.clock;
    this.currentDay = dayKey(this.clock.now());
  }

  private rolloverIfNewDay(): void {
    const today = dayKey(this.clock.now());
    if (today !== this.currentDay) {
      this.currentDay = today;
      this.count = 0;
      this.suppressedTier3Count = 0;
    }
  }

  /** Number of tier-2 sends remaining today. */
  remaining(): number {
    this.rolloverIfNewDay();
    return Math.max(0, this.dailyLimit - this.count);
  }

  /** Number of tier-2 sends used today. */
  get dailyCount(): number {
    this.rolloverIfNewDay();
    return this.count;
  }

  /** Number of tier-3 events folded into the digest instead of pushed. */
  get suppressedCount(): number {
    this.rolloverIfNewDay();
    return this.suppressedTier3Count;
  }

  /**
   * Records an attempt to send a notification of the given tier and returns
   * whether it was actually sent or suppressed.
   */
  recordSend(tier: NotificationTier): NotificationOutcome {
    this.rolloverIfNewDay();

    if (tier === 'tier-1') {
      return 'sent';
    }

    if (tier === 'tier-3') {
      this.suppressedTier3Count += 1;
      return 'suppressed';
    }

    if (this.count >= this.dailyLimit) {
      return 'suppressed';
    }

    this.count += 1;
    return 'sent';
  }
}
