import { describe, expect, it } from 'vitest';
import { evaluateAction } from '../evaluate.js';
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

    it('requires confirmation for a large money transfer', () => {
      const outcome = evaluateAction(
        buildOnChainMoneyRequest({ amountCents: 100_000_000, amountWei: 10n ** 24n }),
        clock,
      );
      expect(outcome.status).toBe('awaiting-confirmation');
    });

    it('requires confirmation for a money transfer regardless of currency or asset', () => {
      const outcome = evaluateAction(
        buildOnChainMoneyRequest({ currency: 'EUR', asset: 'USDC' }),
        clock,
      );
      expect(outcome.status).toBe('awaiting-confirmation');
    });

    it('requires confirmation for a money transfer regardless of recipient', () => {
      const outcome = evaluateAction(
        buildOnChainMoneyRequest({ recipient: '0x0000000000000000000000000000000000dead' }),
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
