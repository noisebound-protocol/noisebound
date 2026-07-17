import { describe, expect, it } from 'vitest';
import {
  confirmEscalation,
  evaluateEscalation,
  type MoneyEscalationRequest,
  type NonMoneyEscalationRequest,
} from '../src/index.js';

describe('evaluateEscalation', () => {
  it('requires confirmation for a money escalation within the spend threshold', () => {
    const request: MoneyEscalationRequest = {
      id: 'esc-1',
      description: 'Wire $500 to a vendor',
      category: 'money',
      amountCents: 50_000,
      currency: 'USD',
      amountWei: 10n ** 15n,
    };

    expect(evaluateEscalation(request, { maxSpendWei: 10n ** 18n })).toBe('require-confirmation');
  });

  it('requires confirmation for a money escalation with no amountWei, including zero cents', () => {
    const request: MoneyEscalationRequest = {
      id: 'esc-2',
      description: 'Zero-value money action',
      category: 'money',
      amountCents: 0,
      currency: 'USD',
    };

    expect(evaluateEscalation(request)).toBe('require-confirmation');
  });

  it('requires secondary confirmation for a money escalation above the spend threshold', () => {
    const request: MoneyEscalationRequest = {
      id: 'esc-3',
      description: 'Wire a large amount to a vendor',
      category: 'money',
      amountCents: 5_000_000,
      currency: 'USD',
      amountWei: 5n * 10n ** 18n,
    };

    expect(evaluateEscalation(request, { maxSpendWei: 10n ** 18n })).toBe(
      'require-secondary-confirmation',
    );
  });

  it('has no way in the type system to mark a money request as pre-approved', () => {
    // MoneyEscalationRequest intentionally has no override/allow field.
    // This assertion documents that guarantee: the only fields available
    // are id, description, category, amountCents, currency, and amountWei.
    const request: MoneyEscalationRequest = {
      id: 'esc-4',
      description: 'Attempted override',
      category: 'money',
      amountCents: 100,
      currency: 'USD',
      amountWei: 1n,
    };

    const keys = Object.keys(request).sort();
    expect(keys).toEqual(['amountCents', 'amountWei', 'category', 'currency', 'description', 'id']);
    expect(evaluateEscalation(request)).not.toBe('allow');
  });

  it('allows a non-money escalation that does not require disclosure', () => {
    const request: NonMoneyEscalationRequest = {
      id: 'esc-5',
      description: 'Call a read-only weather API',
      category: 'external-api',
      requiresDisclosure: false,
    };

    expect(evaluateEscalation(request)).toBe('allow');
  });

  it('requires disclosure for a non-money escalation flagged as such', () => {
    const request: NonMoneyEscalationRequest = {
      id: 'esc-6',
      description: 'Share aggregated usage data with a partner',
      category: 'data-sharing',
      requiresDisclosure: true,
    };

    expect(evaluateEscalation(request)).toBe('require-disclosure');
  });

  it('evaluates irreversible non-money actions based on the disclosure flag', () => {
    const request: NonMoneyEscalationRequest = {
      id: 'esc-7',
      description: 'Permanently delete a stale cache entry',
      category: 'irreversible-action',
      requiresDisclosure: false,
    };

    expect(evaluateEscalation(request)).toBe('allow');
  });
});

describe('confirmEscalation', () => {
  it('never auto-approves a money request without an explicit confirm, even at zero amount', () => {
    const request: MoneyEscalationRequest = {
      id: 'esc-8',
      description: 'Zero-value money action',
      category: 'money',
      amountCents: 0,
      currency: 'USD',
    };

    expect(confirmEscalation(request, { confirmed: false })).toBe('require-confirmation');
  });

  it('approves a within-threshold money request once a single confirm is given', () => {
    const request: MoneyEscalationRequest = {
      id: 'esc-9',
      description: 'Wire $500 to a vendor',
      category: 'money',
      amountCents: 50_000,
      currency: 'USD',
      amountWei: 10n ** 15n,
    };

    expect(confirmEscalation(request, { confirmed: true }, { maxSpendWei: 10n ** 18n })).toBe(
      'allow',
    );
  });

  it('does not approve an above-threshold money request on a single confirm alone', () => {
    const request: MoneyEscalationRequest = {
      id: 'esc-10',
      description: 'Wire a large amount to a vendor',
      category: 'money',
      amountCents: 5_000_000,
      currency: 'USD',
      amountWei: 5n * 10n ** 18n,
    };

    expect(confirmEscalation(request, { confirmed: true }, { maxSpendWei: 10n ** 18n })).toBe(
      'require-secondary-confirmation',
    );
  });

  it('approves an above-threshold money request once both confirmations are given', () => {
    const request: MoneyEscalationRequest = {
      id: 'esc-11',
      description: 'Wire a large amount to a vendor',
      category: 'money',
      amountCents: 5_000_000,
      currency: 'USD',
      amountWei: 5n * 10n ** 18n,
    };

    expect(
      confirmEscalation(
        request,
        { confirmed: true, secondaryConfirmed: true },
        { maxSpendWei: 10n ** 18n },
      ),
    ).toBe('allow');
  });

  it('leaves non-money decisions unaffected by confirmation state', () => {
    const request: NonMoneyEscalationRequest = {
      id: 'esc-12',
      description: 'Share aggregated usage data with a partner',
      category: 'data-sharing',
      requiresDisclosure: true,
    };

    expect(confirmEscalation(request, { confirmed: true })).toBe('require-disclosure');
  });
});
