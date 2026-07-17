import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SerializedIdentityKeyPair } from '@noisebound/identity';

const issueSessionKeyAction = vi.fn(async () => ({
  capability: {
    payload: {
      id: 'cap-1',
      sessionAddress: '0xsession0000000000000000000000000000abcd',
      sessionPublicKey: '0x04pub',
      scope: { maxSpendWei: '10000000000000000' },
      issuedAt: 1000,
      expiresAt: 2000,
    },
    signature: 'c2ln',
  },
  fundingTxHash: '0xfundingtxhash',
}));

vi.mock('../../../app/actions/sessionKeys', () => ({
  issueSessionKeyAction: (...args: unknown[]) => issueSessionKeyAction(...(args as [])),
}));

const { IssueSessionKeyForm } = await import('../IssueSessionKeyForm');

const identity: SerializedIdentityKeyPair = { publicKey: 'pub', secretKey: 'sec' };

describe('IssueSessionKeyForm', () => {
  it('calls issueSessionKeyAction with the identity, scope, and ttl from the form', async () => {
    const user = userEvent.setup();
    const onIssued = vi.fn();

    render(<IssueSessionKeyForm identity={identity} onIssued={onIssued} />);

    const spendInput = screen.getByLabelText('Max spend scope (ETH)');
    await user.clear(spendInput);
    await user.type(spendInput, '0.02');

    await user.click(screen.getByRole('button', { name: 'Issue session key' }));

    expect(issueSessionKeyAction).toHaveBeenCalledWith(
      identity,
      { maxSpendWei: '20000000000000000' },
      24 * 60 * 60 * 1000,
    );

    await screen.findByText(/Issued and funded/);
    expect(onIssued).toHaveBeenCalledOnce();
    const issuedCapability = onIssued.mock.calls[0]?.[0];
    expect(issuedCapability.fundingTxHash).toBe('0xfundingtxhash');
    expect(issuedCapability.revoked).toBe(false);
  });
});
