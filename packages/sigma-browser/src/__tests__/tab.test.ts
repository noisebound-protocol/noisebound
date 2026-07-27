import { describe, expect, it } from 'vitest';
import { tagAgentOwnedTab, tagUserOpenedTab } from '../tab.js';

describe('tab handles', () => {
  it('tags an agent-owned tab with origin agent-owned', () => {
    const tab = tagAgentOwnedTab('tab-1');
    expect(tab.origin).toBe('agent-owned');
    expect(tab.tabId).toBe('tab-1');
  });

  it('tags a user-opened tab with origin user-opened', () => {
    const tab = tagUserOpenedTab('tab-2');
    expect(tab.origin).toBe('user-opened');
    expect(tab.tabId).toBe('tab-2');
  });

  it('produces distinct handles for the same tabId depending on how it was tagged', () => {
    const agentOwned = tagAgentOwnedTab('same-id');
    const userOpened = tagUserOpenedTab('same-id');
    expect(agentOwned.origin).not.toBe(userOpened.origin);
  });
});
