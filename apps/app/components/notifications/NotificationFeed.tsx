import { formatTimestamp } from '../../lib/format';
import type { ProcessedNotification } from '../../lib/notifications';
import styles from './NotificationFeed.module.css';

interface NotificationFeedProps {
  readonly items: readonly ProcessedNotification[];
}

export function NotificationFeed({ items }: NotificationFeedProps) {
  if (items.length === 0) {
    return <p className={styles.empty}>Nothing needs your attention right now.</p>;
  }

  return (
    <div className={styles.feed}>
      {items.map((item) => (
        <div className={styles.item} key={item.id}>
          <span
            className={`${styles.tierMark} ${item.tier === 'tier-1' ? styles.tier1 : styles.tier2}`}
            aria-hidden="true"
          />
          <div className={styles.body}>
            <p className={styles.headline}>{item.headline}</p>
            <p className={styles.detail}>{item.detail}</p>
            <div className={styles.meta}>
              <span>{item.tier === 'tier-1' ? 'Tier 1 · action needed' : 'Tier 2 · market move'}</span>
              <span>{formatTimestamp(item.timestamp)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
