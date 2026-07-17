import type { StoredSessionCapability } from '../../lib/types';
import { SessionCapabilityCard } from './SessionCapabilityCard';
import styles from './SessionCapabilityList.module.css';

interface SessionCapabilityListProps {
  readonly capabilities: readonly StoredSessionCapability[];
  readonly now: number;
  readonly onRevoke?: ((capability: StoredSessionCapability) => void) | undefined;
}

export function SessionCapabilityList({ capabilities, now, onRevoke }: SessionCapabilityListProps) {
  if (capabilities.length === 0) {
    return <p className={styles.empty}>No session capabilities yet.</p>;
  }

  return (
    <div className={styles.list}>
      {capabilities.map((capability) => (
        <SessionCapabilityCard
          key={capability.payload.id}
          capability={capability}
          now={now}
          onRevoke={onRevoke}
        />
      ))}
    </div>
  );
}
