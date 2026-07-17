import Link from 'next/link';
import type { ReactNode } from 'react';
import { PrivateZoneIndicator } from '../escalation/PrivateZoneIndicator';
import styles from './AppShell.module.css';

interface AppShellProps {
  readonly children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className={styles.shell}>
      <nav className={styles.nav}>
        <Link href="/dashboard" className={styles.brand}>
          noisebound <span>σ-1</span>
        </Link>
        <div className={styles.links}>
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/sessions">Session keys</Link>
          <Link href="/notifications">Notifications</Link>
        </div>
        <div className={styles.right}>
          <PrivateZoneIndicator />
        </div>
      </nav>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
