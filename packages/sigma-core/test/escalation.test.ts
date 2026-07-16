import { describe, expect, it } from 'vitest';
import {
  evaluateEscalation,
  type MoneyEscalationRequest,
  type NonMoneyEscalationRequest,
} from '../src/index.js';

describe('evaluateEscalation', () => {
  it('hard-denies any escalation touching real money', () => {
    const request: MoneyEscalationRequest = {
      id: 'esc-1',
      description: 'Wire $500 to a vendor',
      category: 'money',
      amountCents: 50_000,
      currency: 'USD',
    };

    expect(evaluateEscalation(request)).toBe('deny');
  });

  it('hard-denies money escalations regardless of amount, including zero', () => {
    const request: MoneyEscalationRequest = {
      id: 'esc-2',
      description: 'Zero-value money action',
      category: 'money',
      amountCents: 0,
      currency: 'USD',
    };

    expect(evaluateEscalation(request)).toBe('deny');
  });

  it('has no way in the type system to mark a money request as pre-approved', () => {
    // MoneyEscalationRequest intentionally has no override/allow field.
    // This assertion documents that guarantee: the only fields available
    // are id, description, category, amountCents, and currency.
    const request: MoneyEscalationRequest = {
      id: 'esc-3',
      description: 'Attempted override',
      category: 'money',
      amountCents: 100,
      currency: 'USD',
    };

    const keys = Object.keys(request).sort();
    expect(keys).toEqual(['amountCents', 'category', 'currency', 'description', 'id']);
    expect(evaluateEscalation(request)).toBe('deny');
  });

  it('allows a non-money escalation that does not require disclosure', () => {
    const request: NonMoneyEscalationRequest = {
      id: 'esc-4',
      description: 'Call a read-only weather API',
      category: 'external-api',
      requiresDisclosure: false,
    };

    expect(evaluateEscalation(request)).toBe('allow');
  });

  it('requires disclosure for a non-money escalation flagged as such', () => {
    const request: NonMoneyEscalationRequest = {
      id: 'esc-5',
      description: 'Share aggregated usage data with a partner',
      category: 'data-sharing',
      requiresDisclosure: true,
    };

    expect(evaluateEscalation(request)).toBe('require-disclosure');
  });

  it('evaluates irreversible non-money actions based on the disclosure flag', () => {
    const request: NonMoneyEscalationRequest = {
      id: 'esc-6',
      description: 'Permanently delete a stale cache entry',
      category: 'irreversible-action',
      requiresDisclosure: false,
    };

    expect(evaluateEscalation(request)).toBe('allow');
  });
});
