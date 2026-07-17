import type { NetworkConfig } from '@noisebound/networks';
import { Badge } from '../ui/Badge';

interface NetworkBadgeProps {
  readonly network: NetworkConfig;
}

export function NetworkBadge({ network }: NetworkBadgeProps) {
  return (
    <Badge tone="accent" dot>
      {network.displayName} · chain {network.chainId}
    </Badge>
  );
}
