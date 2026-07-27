import { describe, expect, it } from 'vitest';
import { fromAgentToolCall, DEFAULT_SEARCH_MAX_RESULTS, MAX_SEARCH_RESULTS } from '../agentToolCall.js';
import { tagAgentOwnedTab, tagUserOpenedTab } from '../tab.js';

const context = { id: 'req-1', description: 'test request' };

describe('fromAgentToolCall', () => {
  it('converts a search_web call and defaults maxResults when omitted', () => {
    const request = fromAgentToolCall({ kind: 'search_web', query: 'noisebound' }, context);
    expect(request).toEqual({
      kind: 'search_web',
      id: 'req-1',
      description: 'test request',
      query: 'noisebound',
      maxResults: DEFAULT_SEARCH_MAX_RESULTS,
    });
  });

  it('clamps maxResults above the cap', () => {
    const request = fromAgentToolCall({ kind: 'search_web', query: 'q', maxResults: 999 }, context);
    expect(request.kind).toBe('search_web');
    expect((request as { maxResults: number }).maxResults).toBe(MAX_SEARCH_RESULTS);
  });

  it('clamps maxResults below the minimum', () => {
    const request = fromAgentToolCall({ kind: 'search_web', query: 'q', maxResults: 0 }, context);
    expect((request as { maxResults: number }).maxResults).toBe(1);
  });

  it('converts a navigate call with no tab in context, omitting the tab field entirely', () => {
    const request = fromAgentToolCall({ kind: 'navigate', url: 'https://example.com' }, context);
    expect(request).toEqual({
      kind: 'navigate',
      id: 'req-1',
      description: 'test request',
      url: 'https://example.com',
    });
    expect('tab' in request).toBe(false);
  });

  it('carries an agent-owned tab from context through to a navigate request', () => {
    const tab = tagAgentOwnedTab('tab-1');
    const request = fromAgentToolCall(
      { kind: 'navigate', url: 'https://example.com' },
      { ...context, tab },
    );
    expect(request.kind).toBe('navigate');
    expect((request as { tab?: unknown }).tab).toBe(tab);
  });

  it('carries a user-opened tab from context through to an extract_page_data request', () => {
    const tab = tagUserOpenedTab('tab-2');
    const request = fromAgentToolCall(
      { kind: 'extract_page_data', instruction: 'find the price' },
      { ...context, tab },
    );
    expect(request.kind).toBe('extract_page_data');
    expect((request as { tab?: unknown }).tab).toBe(tab);
  });
});
