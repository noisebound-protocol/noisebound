import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ExecutionOutcome } from '@noisebound/sigma-execute';
import type { SendActionInput } from '../../../app/actions/actionTrigger';

const DENIED_OUTCOME: ExecutionOutcome = {
  status: 'denied',
  requestId: 'req-1',
  reason: 'Escalation policy denied this on-chain-money request',
  timestamp: new Date('2026-07-17T12:00:00.000Z'),
};

const evaluateSendActionTrigger = vi.fn(async (_input: SendActionInput) => DENIED_OUTCOME);

vi.mock('../../../app/actions/actionTrigger', () => ({
  evaluateSendActionTrigger: (input: SendActionInput) => evaluateSendActionTrigger(input),
}));

const { ActionTriggerForm } = await import('../ActionTriggerForm');

describe('ActionTriggerForm', () => {
  it('rejects a malformed recipient address without calling evaluateSendActionTrigger', async () => {
    const user = userEvent.setup();
    const onEvaluated = vi.fn();

    render(<ActionTriggerForm onEvaluated={onEvaluated} />);

    await user.type(screen.getByLabelText('Recipient address'), 'not-an-address');
    await user.click(screen.getByRole('button', { name: 'Evaluate action' }));

    expect(await screen.findByText(/valid 0x-prefixed/)).toBeInTheDocument();
    expect(evaluateSendActionTrigger).not.toHaveBeenCalled();
    expect(onEvaluated).not.toHaveBeenCalled();
  });

  it('builds a real on-chain-money ActionRequest and evaluates it via sigma-execute', async () => {
    const user = userEvent.setup();
    const onEvaluated = vi.fn();
    const recipient = '0x1111111111111111111111111111111111111111';

    render(<ActionTriggerForm onEvaluated={onEvaluated} />);

    await user.type(screen.getByLabelText('Recipient address'), recipient);
    const amountInput = screen.getByLabelText('Amount (ETH)');
    await user.clear(amountInput);
    await user.type(amountInput, '0.5');

    await user.click(screen.getByRole('button', { name: 'Evaluate action' }));

    await screen.findByRole('button', { name: 'Evaluate action' });
    expect(evaluateSendActionTrigger).toHaveBeenCalledOnce();
    const input = evaluateSendActionTrigger.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      recipient,
      asset: 'ETH',
      currency: 'ETH',
      amountCents: 50,
      amountWei: '500000000000000000',
    });

    expect(onEvaluated).toHaveBeenCalledOnce();
    const result = onEvaluated.mock.calls[0]?.[0];
    expect(result.request).toMatchObject({
      kind: 'on-chain-money',
      recipient,
      asset: 'ETH',
      amountWei: 500000000000000000n,
    });
    expect(result.outcome).toEqual(DENIED_OUTCOME);
  });
});
