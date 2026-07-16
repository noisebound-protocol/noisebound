import { describe, expect, it } from 'vitest';
import {
  classifyNotification,
  NotificationBudget,
  type Clock,
  type NotificationEvent,
} from '../src/index.js';

class FakeClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return this.current;
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

describe('classifyNotification', () => {
  it('classifies inaction-costs-money as tier-1', () => {
    const event: NotificationEvent = { id: 'n-1', kind: 'inaction-costs-money' };
    expect(classifyNotification(event)).toBe('tier-1');
  });

  it('classifies market-move-on-held-position as tier-2', () => {
    const event: NotificationEvent = { id: 'n-2', kind: 'market-move-on-held-position' };
    expect(classifyNotification(event)).toBe('tier-2');
  });

  it('classifies matched-interest-opportunity as tier-2', () => {
    const event: NotificationEvent = { id: 'n-3', kind: 'matched-interest-opportunity' };
    expect(classifyNotification(event)).toBe('tier-2');
  });

  it('classifies digest-item as tier-3', () => {
    const event: NotificationEvent = { id: 'n-4', kind: 'digest-item' };
    expect(classifyNotification(event)).toBe('tier-3');
  });
});

describe('NotificationBudget', () => {
  it('never blocks tier-1 sends, even after the budget is exhausted', () => {
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));
    const budget = new NotificationBudget({ dailyLimit: 3, clock });

    budget.recordSend('tier-2');
    budget.recordSend('tier-2');
    budget.recordSend('tier-2');
    expect(budget.remaining()).toBe(0);

    const outcome = budget.recordSend('tier-1');

    expect(outcome).toBe('sent');
    expect(budget.dailyCount).toBe(3);
  });

  it('decrements remaining budget on tier-2 sends and suppresses once exhausted', () => {
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));
    const budget = new NotificationBudget({ dailyLimit: 2, clock });

    expect(budget.recordSend('tier-2')).toBe('sent');
    expect(budget.remaining()).toBe(1);

    expect(budget.recordSend('tier-2')).toBe('sent');
    expect(budget.remaining()).toBe(0);

    expect(budget.recordSend('tier-2')).toBe('suppressed');
    expect(budget.dailyCount).toBe(2);
  });

  it('always suppresses tier-3 and tracks the suppressed count instead of the budget', () => {
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));
    const budget = new NotificationBudget({ dailyLimit: 5, clock });

    expect(budget.recordSend('tier-3')).toBe('suppressed');
    expect(budget.recordSend('tier-3')).toBe('suppressed');

    expect(budget.suppressedCount).toBe(2);
    expect(budget.dailyCount).toBe(0);
    expect(budget.remaining()).toBe(5);
  });

  it('resets the daily count and suppressed count when the clock crosses into a new day', () => {
    const clock = new FakeClock(new Date('2026-01-01T23:00:00.000Z'));
    const budget = new NotificationBudget({ dailyLimit: 3, clock });

    budget.recordSend('tier-2');
    budget.recordSend('tier-3');
    expect(budget.dailyCount).toBe(1);
    expect(budget.suppressedCount).toBe(1);

    clock.advance(2 * 60 * 60 * 1000); // cross midnight UTC

    expect(budget.dailyCount).toBe(0);
    expect(budget.suppressedCount).toBe(0);
    expect(budget.remaining()).toBe(3);
  });
});
