import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ExecutionOutcome } from '@noisebound/sigma-execute';
import type { SendActionInput } from '../../../app/actions/actionTrigger';
import type { ExecuteOnChainMoneyActionInput } from '../../../app/actions/onChainExecution';
import { saveStoredSessionCapabilities } from '../../../lib/sessionStore';
import { evaluateActionRequest } from '../../../lib/actionTrigger';
import type { SerializedSessionCapability, StoredSessionCapability } from '../../../lib/types';

const AWAITING_CONFIRMATION_OUTCOME: ExecutionOutcome = {
  status: 'awaiting-confirmation',
  requestId: 'req-1',
  confirmation: { requestId: 'req-1', summary: 'Send 0.5 ETH to 0x1111111111111111111111111111111111111111' },
  timestamp: new Date('2026-07-17T12:00:00.000Z'),
};

const ACTIVE_SESSION_CAPABILITY: StoredSessionCapability = {
  label: 'Test session key',
  fundingTxHash: '0xfeed000000000000000000000000000000000000000000000000000000fe',
  revoked: false,
  payload: {
    id: 'session-active-1',
    sessionAddress: '0x2222222222222222222222222222222222222222',
    sessionPublicKey: '0x02',
    scope: { maxSpendWei: '1000000000000000000' },
    issuedAt: Date.now() - 1_000,
    expiresAt: Date.now() + 3_600_000,
  },
  signature: 'c2ln',
};

const evaluateSendActionTrigger = vi.fn(
  async (_input: SendActionInput): Promise<ExecutionOutcome> => AWAITING_CONFIRMATION_OUTCOME,
);
const executeOnChainMoneyAction = vi.fn(
  async (_input: ExecuteOnChainMoneyActionInput, _sessionCapability: SerializedSessionCapability) =>
    '0xdeadbeef' as const,
);

vi.mock('../../../app/actions/actionTrigger', () => ({
  evaluateSendActionTrigger: (input: SendActionInput) => evaluateSendActionTrigger(input),
}));

vi.mock('../../../app/actions/onChainExecution', () => ({
  executeOnChainMoneyAction: (
    input: ExecuteOnChainMoneyActionInput,
    sessionCapability: SerializedSessionCapability,
  ) => executeOnChainMoneyAction(input, sessionCapability),
}));

const { NotificationsPageClient } = await import('../NotificationsPageClient');

describe('NotificationsPageClient', () => {
  beforeEach(() => {
    window.localStorage.clear();
    saveStoredSessionCapabilities([ACTIVE_SESSION_CAPABILITY]);
  });

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
    const sessionCapability = executeOnChainMoneyAction.mock.calls[0]?.[1];
    expect(sessionCapability).toEqual({
      payload: ACTIVE_SESSION_CAPABILITY.payload,
      signature: ACTIVE_SESSION_CAPABILITY.signature,
    });
    expect(sessionCapability?.payload.sessionAddress).not.toBe(
      '0x000000000000000000000000000000000000ad',
    );

    expect(await screen.findByText(/Sent — tx/)).toBeInTheDocument();
  });

  it('fails with a clear reason instead of calling the executor when there is no active session key', async () => {
    window.localStorage.clear();
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

    expect(await screen.findByText(/No active session key/)).toBeInTheDocument();
    expect(executeOnChainMoneyAction).not.toHaveBeenCalled();
  });

  it('shows the real typed amount in the confirmation dialog, not a rounded-to-zero placeholder', async () => {
    evaluateSendActionTrigger.mockImplementationOnce(async (input: SendActionInput) =>
      evaluateActionRequest({
        kind: 'on-chain-money',
        id: input.id,
        description: input.description,
        amountCents: input.amountCents,
        currency: input.currency,
        amountWei: BigInt(input.amountWei),
        recipient: input.recipient,
        asset: input.asset,
      }),
    );

    const user = userEvent.setup();
    const recipient = '0x1111111111111111111111111111111111111111';

    render(<NotificationsPageClient />);

    await user.type(screen.getByLabelText('Recipient address'), recipient);
    const amountInput = screen.getByLabelText('Amount (ETH)');
    await user.clear(amountInput);
    await user.type(amountInput, '0.001');
    await user.click(screen.getByRole('button', { name: 'Evaluate action' }));

    expect((await screen.findAllByText(/Send 0\.001 ETH/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Send 0 ETH to/)).not.toBeInTheDocument();
  });
});
