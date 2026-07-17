import styles from './SuppressedCounter.module.css';

interface SuppressedCounterProps {
  readonly count: number;
}

export function SuppressedCounter({ count }: SuppressedCounterProps) {
  return (
    <div className={styles.counter}>
      <span className={styles.label}>Folded into today&rsquo;s digest instead of pushed</span>
      <span className={styles.count} data-mono>
        {count} thing{count === 1 ? '' : 's'} held back today
      </span>
    </div>
  );
}
