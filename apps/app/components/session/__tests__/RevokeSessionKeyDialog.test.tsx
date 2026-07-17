import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StoredSessionCapability } from '../../../lib/types';

const revokeSessionKeyAction = vi.fn(async () => undefined);

vi.mock('../../../app/actions/sessionKeys', () => ({
  revokeSessionKeyAction: (...args: unknown[]) => revokeSessionKeyAction(...(args as [])),
}));

const { RevokeSessionKeyDialog } = await import('../RevokeSessionKeyDialog');

const capability: StoredSessionCapability = {
  payload: {
    id: 'cap-1',
    sessionAddress: '0xsession0000000000000000000000000000abcd',
    sessionPublicKey: '0x04pub',
    scope: { maxSpendWei: '10000000000000000' },
    issuedAt: 1000,
    expiresAt: Date.now() + 60_000,
  },
  signature: 'c2ln',
  label: 'Trading session key',
  fundingTxHash: '0xfundingtxhash',
  revoked: false,
};

describe('RevokeSessionKeyDialog', () => {
  it('calls revokeSessionKeyAction with the capability payload and signature, then reports it revoked', async () => {
    const user = userEvent.setup();
    const onRevoked = vi.fn();
    const onCancel = vi.fn();

    render(<RevokeSessionKeyDialog capability={capability} onRevoked={onRevoked} onCancel={onCancel} />);

    await user.click(screen.getByRole('button', { name: 'Revoke session key' }));

    expect(revokeSessionKeyAction).toHaveBeenCalledWith({
      payload: capability.payload,
      signature: capability.signature,
    });

    await waitFor(() => expect(onRevoked).toHaveBeenCalledWith({ ...capability, revoked: true }));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel without revoking when cancelled', async () => {
    const user = userEvent.setup();
    const onRevoked = vi.fn();
    const onCancel = vi.fn();

    render(<RevokeSessionKeyDialog capability={capability} onRevoked={onRevoked} onCancel={onCancel} />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(revokeSessionKeyAction).not.toHaveBeenCalled();
  });
});
