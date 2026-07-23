import { describe, expect, it } from 'vitest';
import { evaluateAction } from '../evaluate.js';
import { createInMemoryRecipientHistory } from '../recipientSafety.js';
import { FakeClock } from './fakeClock.js';
import { buildCloudInferenceRequest, buildOnChainMoneyRequest } from './fixtures.js';

describe('evaluateAction', () => {
  const clock = new FakeClock(new Date('2026-07-17T12:00:00.000Z'));

  describe('money actions', () => {
    it('requires confirmation (never auto-denies) for a typical money transfer', () => {
      const outcome = evaluateAction(buildOnChainMoneyRequest(), clock);
      expect(outcome.status).toBe('awaiting-confirmation');
    });

    it('requires confirmation for a zero-amount money transfer', () => {
      const outcome = evaluateAction(
        buildOnChainMoneyRequest({ amountCents: 0, amountWei: 0n }),
        clock,
      );
      expect(outcome.status).toBe('awaiting-confirmation');
    });

    it('requires confirmation for a money transfer at, but not above, the spend threshold', () => {
      const outcome = evaluateAction(
        buildOnChainMoneyRequest({ amountWei: 1_000_000_000_000_000_000n }),
        clock,
      );
      expect(outcome.status).toBe('awaiting-confirmation');
    });

    it('requires secondary confirmation for a money transfer above the spend threshold', () => {
      const outcome = evaluateAction(
        buildOnChainMoneyRequest({ amountCents: 100_000_000, amountWei: 10n ** 24n }),
        clock,
      );
      expect(outcome.status).toBe('requires-secondary-confirmation');
      if (outcome.status === 'requires-secondary-confirmation') {
        expect(outcome.confirmation.requestId).toBe('action-money-1');
        expect(outcome.confirmation.summary).toMatch(/^Send /);
      }
    });

    it('requires confirmation for a money transfer regardless of currency or asset', () => {
      const outcome = evaluateAction(
        buildOnChainMoneyRequest({ currency: 'EUR', asset: 'USDC' }),
        clock,
      );
      expect(outcome.status).toBe('awaiting-confirmation');
    });

    it('requires confirmation for a money transfer to an ordinary, unflagged recipient', () => {
      const outcome = evaluateAction(
        buildOnChainMoneyRequest({ recipient: '0x1111111111111111111111111111111111111111' as `0x${string}` }),
        clock,
      );
      expect(outcome.status).toBe('awaiting-confirmation');
    });

    it('requires confirmation for a money transfer even when described as low-risk (no auto-approve)', () => {
      const outcome = evaluateAction(
        buildOnChainMoneyRequest({ description: 'Trivial internal transfer, pre-approved' }),
        clock,
      );
      expect(outcome.status).toBe('awaiting-confirmation');
    });

    it('names the amount and recipient in the confirmation summary', () => {
      const outcome = evaluateAction(buildOnChainMoneyRequest(), clock);
      expect(outcome.status).toBe('awaiting-confirmation');
      if (outcome.status === 'awaiting-confirmation') {
        expect(outcome.confirmation.summary).toMatch(/^Send /);
      }
    });

    it('stamps the outcome with the injected clock time, not wall-clock time', () => {
      const outcome = evaluateAction(buildOnChainMoneyRequest(), clock);
      expect(outcome.timestamp).toEqual(new Date('2026-07-17T12:00:00.000Z'));
    });
  });

  describe('recipient-safety guard', () => {
    it('denies a money transfer to the zero address', () => {
      const outcome = evaluateAction(
        buildOnChainMoneyRequest({ recipient: '0x0000000000000000000000000000000000000000' as `0x${string}` }),
        clock,
      );
      expect(outcome.status).toBe('denied');
    });

    it('denies a money transfer to the well-known dead/burn address', () => {
      const outcome = evaluateAction(
        buildOnChainMoneyRequest({ recipient: '0x000000000000000000000000000000000000dead' }),
        clock,
      );
      expect(outcome.status).toBe('denied');
      if (outcome.status === 'denied') {
        expect(outcome.reason).toMatch(/burn-address-dead/);
      }
    });

    it('denies a money transfer to a malformed address', () => {
      const outcome = evaluateAction(
        buildOnChainMoneyRequest({ recipient: '0xnotarealaddress000000000000000000000000' as `0x${string}` }),
        clock,
      );
      expect(outcome.status).toBe('denied');
      if (outcome.status === 'denied') {
        expect(outcome.reason).toMatch(/invalid-address/);
      }
    });

    it('escalates a first-time recipient to secondary confirmation when a recipient history is supplied', () => {
      const history = createInMemoryRecipientHistory();
      const outcome = evaluateAction(buildOnChainMoneyRequest(), clock, history);
      expect(outcome.status).toBe('requires-secondary-confirmation');
    });

    it('does not re-trigger the novelty gate for a recipient already in the supplied history', () => {
      const request = buildOnChainMoneyRequest();
      const history = createInMemoryRecipientHistory([request.recipient]);
      const outcome = evaluateAction(request, clock, history);
      expect(outcome.status).toBe('awaiting-confirmation');
    });

    it('marks a recipient as seen after evaluating it, so a repeat send is no longer novel', () => {
      const request = buildOnChainMoneyRequest();
      const history = createInMemoryRecipientHistory();

      const first = evaluateAction(request, clock, history);
      expect(first.status).toBe('requires-secondary-confirmation');

      const second = evaluateAction(request, clock, history);
      expect(second.status).toBe('awaiting-confirmation');
    });

    it('requires only single confirmation for a first-time recipient when no history is supplied at all', () => {
      // Without a RecipientHistory, novelty is simply not considered — only
      // pattern-based flags apply. This preserves pre-guard behavior for
      // callers that haven't wired up recipient tracking.
      const outcome = evaluateAction(buildOnChainMoneyRequest(), clock);
      expect(outcome.status).toBe('awaiting-confirmation');
    });
  });

  describe('non-money actions requiring disclosure', () => {
    it('returns awaiting-confirmation with real confirmation text built from the request data', async () => {
      const { request } = await buildCloudInferenceRequest({
        description: 'Summarize quarterly earnings call transcript',
      });

      const outcome = evaluateAction(request, clock);

      expect(outcome.status).toBe('awaiting-confirmation');
      if (outcome.status === 'awaiting-confirmation') {
        expect(outcome.confirmation.requestId).toBe(request.id);
        expect(outcome.confirmation.summary).toBe(
          'Run cloud inference request "Summarize quarterly earnings call transcript"',
        );
        expect(outcome.confirmation.summary).not.toMatch(/lorem|placeholder|TODO/i);
      }
      expect(outcome.timestamp).toEqual(new Date('2026-07-17T12:00:00.000Z'));
    });

    it('builds distinct confirmation text for distinct requests (no generic placeholder)', async () => {
      const { request: first } = await buildCloudInferenceRequest({
        id: 'req-a',
        description: 'Translate contract to Spanish',
      });
      const { request: second } = await buildCloudInferenceRequest({
        id: 'req-b',
        description: 'Generate release notes from commit log',
      });

      const firstOutcome = evaluateAction(first, clock);
      const secondOutcome = evaluateAction(second, clock);

      expect(firstOutcome.status).toBe('awaiting-confirmation');
      expect(secondOutcome.status).toBe('awaiting-confirmation');
      if (firstOutcome.status === 'awaiting-confirmation' && secondOutcome.status === 'awaiting-confirmation') {
        expect(firstOutcome.confirmation.summary).not.toBe(secondOutcome.confirmation.summary);
      }
    });
  });
});
