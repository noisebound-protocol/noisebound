import { describe, expect, it } from 'vitest';
import { evaluateBrowserAction } from '../evaluate.js';
import { tagAgentOwnedTab, tagUserOpenedTab } from '../tab.js';
import type { BrowserToolRequest } from '../types.js';

const base = { id: 'req-1', description: 'test request' };

describe('evaluateBrowserAction', () => {
  it('allows search_web silently, since it never acts inside a tab', () => {
    const request: BrowserToolRequest = { ...base, kind: 'search_web', query: 'q', maxResults: 5 };
    expect(evaluateBrowserAction(request)).toEqual({ status: 'allowed' });
  });

  it('allows navigate with no tab (a fresh agent-owned tab will be spun up)', () => {
    const request: BrowserToolRequest = { ...base, kind: 'navigate', url: 'https://example.com' };
    expect(evaluateBrowserAction(request)).toEqual({ status: 'allowed' });
  });

  it('allows navigate inside an agent-owned tab', () => {
    const request: BrowserToolRequest = {
      ...base,
      kind: 'navigate',
      url: 'https://example.com',
      tab: tagAgentOwnedTab('tab-1'),
    };
    expect(evaluateBrowserAction(request)).toEqual({ status: 'allowed' });
  });

  it('forces require-disclosure for navigate inside a user-opened tab, with a human-readable summary', () => {
    const request: BrowserToolRequest = {
      ...base,
      kind: 'navigate',
      url: 'https://example.com',
      tab: tagUserOpenedTab('tab-2'),
    };
    const outcome = evaluateBrowserAction(request);
    expect(outcome.status).toBe('requires-disclosure');
    expect((outcome as { summary: string }).summary).toContain('tab you already had open');
  });

  it('forces require-disclosure for extract_page_data inside a user-opened tab', () => {
    const request: BrowserToolRequest = {
      ...base,
      kind: 'extract_page_data',
      instruction: 'find the price',
      tab: tagUserOpenedTab('tab-3'),
    };
    const outcome = evaluateBrowserAction(request);
    expect(outcome.status).toBe('requires-disclosure');
  });

  it('allows extract_page_data inside an agent-owned tab', () => {
    const request: BrowserToolRequest = {
      ...base,
      kind: 'extract_page_data',
      instruction: 'find the price',
      tab: tagAgentOwnedTab('tab-4'),
    };
    expect(evaluateBrowserAction(request)).toEqual({ status: 'allowed' });
  });
});
