import { NotificationBudget, SystemClock, classifyNotification } from '@noisebound/sigma-core';
import type { NotificationTier } from '@noisebound/sigma-core';
import type { NotificationFixtureItem } from './fixtures/notificationFixtures';

export interface ProcessedNotification extends NotificationFixtureItem {
  readonly tier: NotificationTier;
}

export interface ProcessedNotifications {
  readonly visible: readonly ProcessedNotification[];
  readonly suppressedTier3Count: number;
  readonly budgetExhaustedTier2Count: number;
}

/**
 * Replays fixture events through the real tiering + budget policy: tier-1
 * always surfaces, tier-2 surfaces until the daily budget is spent, tier-3
 * never surfaces individually and only increments the digest counter.
 */
export function processNotificationFixtures(
  events: readonly NotificationFixtureItem[],
  dailyLimit: number,
): ProcessedNotifications {
  const budget = new NotificationBudget({ dailyLimit, clock: new SystemClock() });
  const chronological = [...events].sort((a, b) => a.timestamp - b.timestamp);

  const visible: ProcessedNotification[] = [];
  let budgetExhaustedTier2Count = 0;

  for (const event of chronological) {
    const tier = classifyNotification(event);
    const outcome = budget.recordSend(tier);

    if (tier === 'tier-3') continue;

    if (outcome === 'suppressed') {
      budgetExhaustedTier2Count += 1;
      continue;
    }

    visible.push({ ...event, tier });
  }

  return {
    visible: visible.reverse(),
    suppressedTier3Count: budget.suppressedCount,
    budgetExhaustedTier2Count,
  };
}
