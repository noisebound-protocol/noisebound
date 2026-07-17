import styles from './PrivateZoneIndicator.module.css';

interface PrivateZoneIndicatorProps {
  readonly active?: boolean;
}

/** Persistent ambient indicator of whether the agent is currently confined to the private zone. */
export function PrivateZoneIndicator({ active = true }: PrivateZoneIndicatorProps) {
  return (
    <span className={`${styles.indicator} ${active ? styles.active : styles.inactive}`}>
      <span className={styles.dot} aria-hidden="true" />
      {active ? 'Private zone active' : 'Escalation in progress'}
    </span>
  );
}
