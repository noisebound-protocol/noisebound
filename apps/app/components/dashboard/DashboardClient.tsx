'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { NetworkConfig } from '@noisebound/networks';
import { getBalancesAction } from '../../app/actions/network';
import { loadStoredIdentity } from '../../lib/identityStore';
import { pickPrimaryCapability } from '../../lib/sessionCapabilities';
import { loadStoredSessionCapabilities } from '../../lib/sessionStore';
import type { StoredSessionCapability } from '../../lib/types';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { BalanceCard } from './BalanceCard';
import styles from './DashboardClient.module.css';
import { NetworkBadge } from './NetworkBadge';
import { SessionCapabilityList } from '../session/SessionCapabilityList';

interface DashboardClientProps {
  readonly network: NetworkConfig;
}

type BalanceState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; nativeWei: bigint; usdcRaw: bigint }
  | { status: 'error'; message: string };

export function DashboardClient({ network }: DashboardClientProps) {
  const [hasIdentity, setHasIdentity] = useState<boolean | null>(null);
  const [capabilities, setCapabilities] = useState<StoredSessionCapability[]>([]);
  const [balances, setBalances] = useState<BalanceState>({ status: 'idle' });
  const [now] = useState(() => Date.now());

  useEffect(() => {
    setHasIdentity(loadStoredIdentity() !== null);
    setCapabilities(loadStoredSessionCapabilities());
  }, []);

  const primary = pickPrimaryCapability(capabilities, now);

  useEffect(() => {
    if (!primary) return;
    let cancelled = false;
    setBalances({ status: 'loading' });
    getBalancesAction(primary.payload.sessionAddress)
      .then((result) => {
        if (cancelled) return;
        setBalances({ status: 'ready', nativeWei: BigInt(result.nativeWei), usdcRaw: BigInt(result.usdcRaw) });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setBalances({
          status: 'error',
          message: error instanceof Error ? error.message : 'Failed to load balances.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [primary]);

  if (hasIdentity === false) {
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
      <div className={styles.header}>
        <h1 className={styles.title}>Dashboard</h1>
        <NetworkBadge network={network} />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <p className={styles.sectionTitle}>Balances</p>
        </div>
        {!primary ? (
          <Panel className={styles.emptyState}>
            <p className={styles.emptyBody}>No active session key yet — issue one to fund your agent.</p>
            <Link href="/sessions">
              <Button variant="primary">Issue a session key</Button>
            </Link>
          </Panel>
        ) : balances.status === 'ready' ? (
          <BalanceCard nativeWei={balances.nativeWei} usdcRaw={balances.usdcRaw} />
        ) : balances.status === 'error' ? (
          <p className={styles.status}>{balances.message}</p>
        ) : (
          <p className={styles.status}>Loading balances&hellip;</p>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <p className={styles.sectionTitle}>Session capabilities</p>
          <Link href="/sessions">
            <Button variant="ghost">Manage</Button>
          </Link>
        </div>
        <SessionCapabilityList capabilities={capabilities} now={now} />
      </div>
    </div>
  );
}
