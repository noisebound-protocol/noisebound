import { formatTimestamp } from '../../lib/format';
import type { EscalationLogEntry } from '../../lib/types';
import { Badge } from '../ui/Badge';
import styles from './EscalationLog.module.css';

const OUTCOME_TONE = {
  confirmed: 'accent',
  declined: 'neutral',
  blocked: 'danger',
  'auto-allowed': 'success',
} as const;

interface EscalationLogProps {
  readonly entries: readonly EscalationLogEntry[];
}

export function EscalationLog({ entries }: EscalationLogProps) {
  return (
    <div className={styles.log}>
      <p className={styles.heading}>Escalation log</p>
      {entries.length === 0 ? (
        <p className={styles.empty}>No escalations yet.</p>
      ) : (
        entries.map((entry) => (
          <div className={styles.entry} key={entry.id}>
            <span className={styles.timestamp} data-mono>
              {formatTimestamp(entry.timestamp)}
            </span>
            <span className={styles.description}>{entry.description}</span>
            <Badge tone={OUTCOME_TONE[entry.outcome]}>{entry.outcome}</Badge>
          </div>
        ))
      )}
    </div>
  );
}
