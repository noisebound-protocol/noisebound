import { formatDuration, formatUnits, msUntil, truncateAddress } from '../../lib/format';
import type { StoredSessionCapability } from '../../lib/types';
import { isCapabilityActive } from '../../lib/sessionCapabilities';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import styles from './SessionCapabilityCard.module.css';

interface SessionCapabilityCardProps {
  readonly capability: StoredSessionCapability;
  readonly now: number;
  readonly onRevoke?: ((capability: StoredSessionCapability) => void) | undefined;
}

export function SessionCapabilityCard({ capability, now, onRevoke }: SessionCapabilityCardProps) {
  const active = isCapabilityActive(capability, now);
  const remainingMs = msUntil(capability.payload.expiresAt, now);

  return (
    <Panel className={styles.card}>
      <div className={styles.left}>
        <span className={styles.label}>{capability.label}</span>
        <span className={styles.address} data-mono>
          {truncateAddress(capability.payload.sessionAddress)}
        </span>
        <div className={styles.meta}>
          <span>Max spend {formatUnits(BigInt(capability.payload.scope.maxSpendWei), 18, 4)} ETH</span>
          <span>·</span>
          <span>{active ? `Expires in ${formatDuration(remainingMs)}` : 'Expired'}</span>
        </div>
      </div>
      <div className={styles.right}>
        {capability.revoked ? (
          <Badge tone="danger">Revoked</Badge>
        ) : active ? (
          <Badge tone="success" dot>
            Active
          </Badge>
        ) : (
          <Badge tone="neutral">Expired</Badge>
        )}
        {onRevoke && !capability.revoked && active ? (
          <Button variant="danger" onClick={() => onRevoke(capability)}>
            Revoke
          </Button>
        ) : null}
      </div>
    </Panel>
  );
}
