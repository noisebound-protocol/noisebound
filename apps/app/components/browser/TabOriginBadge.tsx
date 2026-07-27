import type { TabOrigin } from '@noisebound/sigma-browser';
import { Badge } from '../ui/Badge';

interface TabOriginBadgeProps {
  readonly origin: TabOrigin;
}

/**
 * Per-tab actor label for whatever tab-bar/browser-panel UI eventually
 * consumes it (docs/decisions/browser-tab-ui-and-origin-transitions.md,
 * Decision #1). agent-owned is the unremarkable default; user-opened is the
 * state worth noticing, since it's the one that forces disclosure in
 * sigma-browser's evaluate.ts — so it gets the louder accent+dot treatment,
 * mirroring NetworkBadge's existing tone="accent" + dot pattern.
 */
export function TabOriginBadge({ origin }: TabOriginBadgeProps) {
  if (origin === 'user-opened') {
    return (
      <Badge tone="accent" dot>
        Your tab
      </Badge>
    );
  }

  return <Badge tone="neutral">σ-1</Badge>;
}
