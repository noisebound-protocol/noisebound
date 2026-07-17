import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EscalationRequest } from '@noisebound/sigma-core';
import { EscalationDialog } from '../EscalationDialog';

const MONEY_REQUEST: EscalationRequest = {
  id: 'esc-money-1',
  category: 'money',
  description: 'Wire $340.00 to an external bank account',
  amountCents: 34000,
  currency: 'USD',
};

const SWAP_REQUEST: EscalationRequest = {
  id: 'esc-swap-1',
  category: 'irreversible-action',
  description: 'Swap 0.5 ETH for USDC using the session key allowance',
  requiresDisclosure: true,
};

describe('EscalationDialog', () => {
  it('requires explicit confirmation for money-category requests instead of hard-blocking them', () => {
    const onConfirm = vi.fn();
    const onStayPrivate = vi.fn();

    render(
      <EscalationDialog
        request={MONEY_REQUEST}
        dataDisclosure={[{ label: 'Amount', value: '$340.00 USD' }]}
        actionText="Send $340 to 0x4f2...9a1"
        log={[]}
        onConfirm={onConfirm}
        onStayPrivate={onStayPrivate}
        onAcknowledgeBlocked={vi.fn()}
      />,
    );

    expect(screen.queryByText(/never leaves the private zone/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Got it' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send $340 to 0x4f2...9a1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stay private, reduced capability' })).toBeInTheDocument();
  });

  it('invokes onConfirm and onStayPrivate for a money-category request', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onStayPrivate = vi.fn();

    render(
      <EscalationDialog
        request={MONEY_REQUEST}
        dataDisclosure={[]}
        actionText="Send $340 to 0x4f2...9a1"
        log={[]}
        onConfirm={onConfirm}
        onStayPrivate={onStayPrivate}
        onAcknowledgeBlocked={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Send $340 to 0x4f2...9a1' }));
    expect(onConfirm).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'Stay private, reduced capability' }));
    expect(onStayPrivate).toHaveBeenCalledOnce();
  });

  it('names the real action on the confirm button for a confirmable escalation', () => {
    render(
      <EscalationDialog
        request={SWAP_REQUEST}
        dataDisclosure={[{ label: 'From', value: '0.5 ETH' }]}
        actionText="Swap 0.5 ETH for USDC via 0x4f2...6f7"
        log={[]}
        onConfirm={vi.fn()}
        onStayPrivate={vi.fn()}
        onAcknowledgeBlocked={vi.fn()}
      />,
    );

    const confirmButton = screen.getByRole('button', { name: 'Swap 0.5 ETH for USDC via 0x4f2...6f7' });
    expect(confirmButton).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stay private, reduced capability' })).toBeInTheDocument();
  });

  it('invokes onConfirm and onStayPrivate for a confirmable escalation', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onStayPrivate = vi.fn();

    render(
      <EscalationDialog
        request={SWAP_REQUEST}
        dataDisclosure={[]}
        actionText="Swap 0.5 ETH for USDC via 0x4f2...6f7"
        log={[]}
        onConfirm={onConfirm}
        onStayPrivate={onStayPrivate}
        onAcknowledgeBlocked={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Swap 0.5 ETH for USDC via 0x4f2...6f7' }));
    expect(onConfirm).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'Stay private, reduced capability' }));
    expect(onStayPrivate).toHaveBeenCalledOnce();
  });

  it('renders the granular data disclosure list for confirmable escalations', () => {
    render(
      <EscalationDialog
        request={SWAP_REQUEST}
        dataDisclosure={[
          { label: 'From', value: '0.5 ETH' },
          { label: 'Router', value: '0x4f2...6f7' },
        ]}
        actionText="Swap 0.5 ETH for USDC via 0x4f2...6f7"
        log={[]}
        onConfirm={vi.fn()}
        onStayPrivate={vi.fn()}
        onAcknowledgeBlocked={vi.fn()}
      />,
    );

    expect(screen.getByText('From')).toBeInTheDocument();
    expect(screen.getByText('0.5 ETH')).toBeInTheDocument();
    expect(screen.getByText('Router')).toBeInTheDocument();
  });
});
