import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ExecutionOutcome } from '@noisebound/sigma-execute';
import type { SendActionInput } from '../../../app/actions/actionTrigger';
import type { ExecuteOnChainMoneyActionInput } from '../../../app/actions/onChainExecution';

const AWAITING_CONFIRMATION_OUTCOME: ExecutionOutcome = {
  status: 'awaiting-confirmation',
  requestId: 'req-1',
  confirmation: { requestId: 'req-1', summary: 'Send 0.5 ETH to 0x1111111111111111111111111111111111111111' },
  timestamp: new Date('2026-07-17T12:00:00.000Z'),
};

const evaluateSendActionTrigger = vi.fn(async (_input: SendActionInput) => AWAITING_CONFIRMATION_OUTCOME);
const executeOnChainMoneyAction = vi.fn(async (_input: ExecuteOnChainMoneyActionInput) => '0xdeadbeef' as const);

vi.mock('../../../app/actions/actionTrigger', () => ({
  evaluateSendActionTrigger: (input: SendActionInput) => evaluateSendActionTrigger(input),
}));

vi.mock('../../../app/actions/onChainExecution', () => ({
  executeOnChainMoneyAction: (input: ExecuteOnChainMoneyActionInput) => executeOnChainMoneyAction(input),
}));

const { NotificationsPageClient } = await import('../NotificationsPageClient');

describe('NotificationsPageClient', () => {
  it('confirming an awaiting-confirmation on-chain-money action runs it through the real executor action', async () => {
    const user = userEvent.setup();
    const recipient = '0x1111111111111111111111111111111111111111';

    render(<NotificationsPageClient />);

    await user.type(screen.getByLabelText('Recipient address'), recipient);
    const amountInput = screen.getByLabelText('Amount (ETH)');
    await user.clear(amountInput);
    await user.type(amountInput, '0.5');
    await user.click(screen.getByRole('button', { name: 'Evaluate action' }));

    const confirmButton = await screen.findByRole('button', {
      name: AWAITING_CONFIRMATION_OUTCOME.status === 'awaiting-confirmation'
        ? AWAITING_CONFIRMATION_OUTCOME.confirmation.summary
        : '',
    });
    await user.click(confirmButton);

    expect(executeOnChainMoneyAction).toHaveBeenCalledOnce();
    const input = executeOnChainMoneyAction.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      recipient,
      asset: 'ETH',
      amountWei: '500000000000000000',
    });

    expect(await screen.findByText(/Sent — tx/)).toBeInTheDocument();
  });
});
