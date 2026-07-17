import type { ReactNode } from 'react';
import styles from './Badge.module.css';

type Tone = 'neutral' | 'accent' | 'danger' | 'warning' | 'success';

interface BadgeProps {
  readonly tone?: Tone;
  readonly dot?: boolean;
  readonly children: ReactNode;
}

export function Badge({ tone = 'neutral', dot = false, children }: BadgeProps) {
  return (
    <span className={`${styles.badge} ${styles[tone]}`}>
      {dot ? <span className={styles.dot} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
