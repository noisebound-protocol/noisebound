import { describe, expect, it } from 'vitest';
import { evaluateAgentAction, fromAgentMoneyAction } from '../agentAction.js';
import { FakeClock } from './fakeClock.js';
import type { AgentMoneyActionRequest } from '../types.js';

const RECIPIENT = '0x4f2a1b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a' as const;

function buildAgentMoneyRequest(
  overrides: Partial<AgentMoneyActionRequest> = {},
): AgentMoneyActionRequest {
  return {
    kind: 'on-chain-money',
    id: 'agent-action-1',
    description: 'Send funds to counterparty',
    recipient: RECIPIENT,
    amount: '0.001',
    asset: 'ETH',
    ...overrides,
  };
}

describe('fromAgentMoneyAction', () => {
  it('converts a decimal amount to exact wei, never via float arithmetic', () => {
    const request = fromAgentMoneyAction(buildAgentMoneyRequest({ amount: '0.0001' }));
    expect(request.amountWei).toBe(100_000_000_000_000n);
  });

  it('preserves sub-cent precision', () => {
    const request = fromAgentMoneyAction(buildAgentMoneyRequest({ amount: '0.0000037' }));
    expect(request.amountWei).toBe(3_700_000_000_000n);
  });

  it('preserves full 18-digit precision for whole-plus-fraction amounts', () => {
    const request = fromAgentMoneyAction(
      buildAgentMoneyRequest({ amount: '1.000000000000000001' }),
    );
    expect(request.amountWei).toBe(1_000_000_000_000_000_001n);
  });

  it('carries recipient and asset through unchanged', () => {
    const request = fromAgentMoneyAction(buildAgentMoneyRequest({ asset: 'ETH' }));
    expect(request.recipient).toBe(RECIPIENT);
    expect(request.asset).toBe('ETH');
    expect(request.kind).toBe('on-chain-money');
  });

  it('rejects a malformed decimal amount before it reaches the trusted request shape', () => {
    expect(() => fromAgentMoneyAction(buildAgentMoneyRequest({ amount: 'not a number' }))).toThrow();
  });

  it('rejects more than 18 fractional digits', () => {
    expect(() =>
      fromAgentMoneyAction(buildAgentMoneyRequest({ amount: '0.0000000000000000001' })),
    ).toThrow();
  });
});

describe('evaluateAgentAction', () => {
  const clock = new FakeClock(new Date('2026-07-17T12:00:00.000Z'));

  it('converts and then requires confirmation, same as any other money action', () => {
    const outcome = evaluateAgentAction(buildAgentMoneyRequest({ amount: '0.001' }), clock);
    expect(outcome.status).toBe('awaiting-confirmation');
  });

  it('rejects a malformed amount before escalation logic ever runs', () => {
    expect(() =>
      evaluateAgentAction(buildAgentMoneyRequest({ amount: '12.34.56' }), clock),
    ).toThrow();
  });

  it('feeds the converted wei amount (not the original decimal string) into the confirmation summary', () => {
    const outcome = evaluateAgentAction(buildAgentMoneyRequest({ amount: '0.001' }), clock);
    expect(outcome.status).toBe('awaiting-confirmation');
    if (outcome.status === 'awaiting-confirmation') {
      expect(outcome.confirmation.summary).toBe(`Send 0.001 ETH to ${RECIPIENT.slice(0, 5)}...${RECIPIENT.slice(-3)}`);
    }
  });
});
