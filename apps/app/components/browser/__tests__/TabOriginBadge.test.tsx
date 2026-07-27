import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TabOriginBadge } from '../TabOriginBadge';

describe('TabOriginBadge', () => {
  it('labels an agent-owned tab as σ-1', () => {
    render(<TabOriginBadge origin="agent-owned" />);
    expect(screen.getByText('σ-1')).toBeInTheDocument();
  });

  it('labels a user-opened tab as "Your tab"', () => {
    render(<TabOriginBadge origin="user-opened" />);
    expect(screen.getByText('Your tab')).toBeInTheDocument();
  });
});
