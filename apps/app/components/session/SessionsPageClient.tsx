'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { SerializedIdentityKeyPair } from '@noisebound/identity';
import { loadStoredIdentity } from '../../lib/identityStore';
import { loadStoredSessionCapabilities, saveStoredSessionCapabilities } from '../../lib/sessionStore';
import type { StoredSessionCapability } from '../../lib/types';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { IssueSessionKeyForm } from './IssueSessionKeyForm';
import { RevokeSessionKeyDialog } from './RevokeSessionKeyDialog';
import { SessionCapabilityList } from './SessionCapabilityList';
import styles from './SessionsPageClient.module.css';

export function SessionsPageClient() {
  const [identity, setIdentity] = useState<SerializedIdentityKeyPair | null>(null);
  const [capabilities, setCapabilities] = useState<StoredSessionCapability[]>([]);
  const [pendingRevoke, setPendingRevoke] = useState<StoredSessionCapability | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    setIdentity(loadStoredIdentity());
    setCapabilities(loadStoredSessionCapabilities());
  }, []);

  function persist(next: StoredSessionCapability[]) {
    setCapabilities(next);
    saveStoredSessionCapabilities(next);
  }

  function handleIssued(capability: StoredSessionCapability) {
    persist([capability, ...capabilities]);
  }

  function handleRevoked(revoked: StoredSessionCapability) {
    persist(capabilities.map((c) => (c.payload.id === revoked.payload.id ? revoked : c)));
    setPendingRevoke(null);
  }

  if (identity === null) {
    return (
      <Panel className={styles.emptyState}>
        <p className={styles.emptyBody}>No identity found on this device yet.</p>
        <Link href="/">
          <Button variant="primary">Get started</Button>
        </Link>
      </Panel>
    );
  }

  return (
    <div>
      <h1 className={styles.title}>Session keys</h1>

      <div className={styles.section}>
        <p className={styles.sectionTitle}>Issue a new session key</p>
        <IssueSessionKeyForm identity={identity} onIssued={handleIssued} />
      </div>

      <div className={styles.section}>
        <p className={styles.sectionTitle}>Active &amp; past session capabilities</p>
        <SessionCapabilityList capabilities={capabilities} now={now} onRevoke={setPendingRevoke} />
      </div>

      {pendingRevoke ? (
        <RevokeSessionKeyDialog
          capability={pendingRevoke}
          onRevoked={handleRevoked}
          onCancel={() => setPendingRevoke(null)}
        />
      ) : null}
    </div>
  );
}
