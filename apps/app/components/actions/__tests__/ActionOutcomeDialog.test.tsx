import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ActionRequest, ExecutionOutcome } from '@noisebound/sigma-execute';
import { ActionOutcomeDialog } from '../ActionOutcomeDialog';

const LARGE_MONEY_REQUEST: ActionRequest = {
  kind: 'on-chain-money',
  id: 'action-money-2',
  description: 'Send 5 ETH to 0x4f2a1b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a',
  amountCents: 500_000,
  currency: 'USD',
  amountWei: 5_000_000_000_000_000_000n,
  recipient: '0x4f2a1b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a',
  asset: 'ETH',
};

const SECONDARY_CONFIRMATION_OUTCOME: ExecutionOutcome = {
  status: 'requires-secondary-confirmation',
  requestId: LARGE_MONEY_REQUEST.id,
  confirmation: {
    requestId: LARGE_MONEY_REQUEST.id,
    summary: 'Send 5 ETH to 0x4f2a...f9a',
  },
  timestamp: new Date('2026-07-21T12:00:00.000Z'),
};

describe('ActionOutcomeDialog', () => {
  it('shows the amber secondary-confirmation banner for a requires-secondary-confirmation outcome', () => {
    render(
      <ActionOutcomeDialog
        request={LARGE_MONEY_REQUEST}
        outcome={SECONDARY_CONFIRMATION_OUTCOME}
        log={[]}
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText(/extra confirmation required/i)).toBeInTheDocument();
    expect(screen.getByText(/exceeds your spend-limit threshold/i)).toBeInTheDocument();
    // No typed-amount field yet — that only appears once the first tap arms the secondary confirmation.
    expect(screen.queryByLabelText(/type .* to confirm/i)).not.toBeInTheDocument();
  });

  it('keeps the confirm button disabled until the typed amount matches, then calls onConfirm', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <ActionOutcomeDialog
        request={LARGE_MONEY_REQUEST}
        outcome={SECONDARY_CONFIRMATION_OUTCOME}
        log={[]}
        onConfirm={onConfirm}
        onDismiss={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: SECONDARY_CONFIRMATION_OUTCOME.confirmation.summary }));

    const confirmButton = screen.getByRole('button', { name: SECONDARY_CONFIRMATION_OUTCOME.confirmation.summary });
    const amountInput = screen.getByLabelText(/type 5000\.00 to confirm/i);
    expect(confirmButton).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();

    await user.type(amountInput, '340.00');
    expect(confirmButton).toBeDisabled();

    await user.clear(amountInput);
    await user.type(amountInput, '5000.00');
    expect(confirmButton).toBeEnabled();

    await user.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('lets the user stay private instead of arming a secondary confirmation', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();

    render(
      <ActionOutcomeDialog
        request={LARGE_MONEY_REQUEST}
        outcome={SECONDARY_CONFIRMATION_OUTCOME}
        log={[]}
        onConfirm={vi.fn()}
        onDismiss={onDismiss}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Stay private, reduced capability' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
