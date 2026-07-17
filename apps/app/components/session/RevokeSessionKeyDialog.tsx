'use client';

import { useState } from 'react';
import { revokeSessionKeyAction } from '../../app/actions/sessionKeys';
import { truncateAddress } from '../../lib/format';
import type { StoredSessionCapability } from '../../lib/types';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import styles from './RevokeSessionKeyDialog.module.css';

interface RevokeSessionKeyDialogProps {
  readonly capability: StoredSessionCapability;
  readonly onRevoked: (capability: StoredSessionCapability) => void;
  readonly onCancel: () => void;
}

export function RevokeSessionKeyDialog({ capability, onRevoked, onCancel }: RevokeSessionKeyDialogProps) {
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = 'revoke-dialog-title';

  async function handleConfirm() {
    setRevoking(true);
    setError(null);
    try {
      await revokeSessionKeyAction({ payload: capability.payload, signature: capability.signature });
      onRevoked({ ...capability, revoked: true });
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Failed to revoke session key.');
      setRevoking(false);
    }
  }

  return (
    <Modal titleId={titleId} onDismiss={revoking ? undefined : onCancel}>
      <h2 id={titleId} className={styles.title}>
        Revoke &ldquo;{capability.label}&rdquo;?
      </h2>
      <p className={styles.body}>
        <span className={styles.address} data-mono>
          {truncateAddress(capability.payload.sessionAddress)}
        </span>{' '}
        will immediately lose its ability to sign any further scoped actions. This can&rsquo;t be
        undone.
      </p>
      {error ? <p className={styles.error}>{error}</p> : null}
      <div className={styles.actions}>
        <Button variant="secondary" onClick={onCancel} disabled={revoking}>
          Cancel
        </Button>
        <Button variant="danger" onClick={() => void handleConfirm()} disabled={revoking}>
          {revoking ? 'Revoking…' : 'Revoke session key'}
        </Button>
      </div>
    </Modal>
  );
}
