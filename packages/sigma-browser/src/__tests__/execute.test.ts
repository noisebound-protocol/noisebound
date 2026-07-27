import { describe, expect, it, vi } from 'vitest';
import { runBrowserToolRequest, runConfirmedBrowserToolRequest } from '../execute.js';
import { createStubBrowserAutomation } from '../stubAutomation.js';
import { tagAgentOwnedTab, tagUserOpenedTab } from '../tab.js';
import type { BrowserAutomation } from '../automation.js';
import type { BrowserToolRequest } from '../types.js';
import { FakeClock } from './fakeClock.js';

const base = { id: 'req-1', description: 'test request' };
const clock = new FakeClock(new Date('2026-07-26T14:03:00.000Z'));

/** An automation whose every method fails the test if called — for asserting a blocked path never touches automation. */
function unreachableAutomation(): BrowserAutomation {
  const fail = (method: string) => {
    throw new Error(`automation.${method} should not have been called`);
  };
  return {
    openAgentOwnedTab: vi.fn(() => fail('openAgentOwnedTab')),
    search: vi.fn(() => fail('search')),
    navigate: vi.fn(() => fail('navigate')),
    extract: vi.fn(() => fail('extract')),
  } as unknown as BrowserAutomation;
}

describe('runBrowserToolRequest', () => {
  it('runs search_web and stamps the mandatory timestamp', async () => {
    const automation = createStubBrowserAutomation({
      search: { noisebound: { results: [{ title: 'Noisebound', url: 'https://noisebound.xyz', snippet: '...' }] } },
    });
    const request: BrowserToolRequest = { ...base, kind: 'search_web', query: 'noisebound', maxResults: 5 };

    const outcome = await runBrowserToolRequest(request, automation, clock);

    expect(outcome.status).toBe('executed');
    expect(outcome.requestId).toBe('req-1');
    const result = (outcome as Extract<typeof outcome, { status: 'executed' }>).result;
    expect(result).toEqual({
      kind: 'search_web',
      query: 'noisebound',
      results: [{ title: 'Noisebound', url: 'https://noisebound.xyz', snippet: '...' }],
      resultCount: 1,
      timestamp: '2026-07-26T14:03:00.000Z',
    });
  });

  it('opens a fresh agent-owned tab for navigate when no tab is supplied', async () => {
    const automation = createStubBrowserAutomation({
      navigate: { 'https://example.com': { finalUrl: 'https://example.com', title: 'Example', status: 'loaded' } },
    });
    const request: BrowserToolRequest = { ...base, kind: 'navigate', url: 'https://example.com' };

    const outcome = await runBrowserToolRequest(request, automation, clock);

    expect(outcome.status).toBe('executed');
    const result = (outcome as Extract<typeof outcome, { status: 'executed' }>).result as {
      kind: string;
      tab: { origin: string };
      status: string;
      timestamp: string;
    };
    expect(result.kind).toBe('navigate');
    expect(result.tab.origin).toBe('agent-owned');
    expect(result.status).toBe('loaded');
    expect(result.timestamp).toBe('2026-07-26T14:03:00.000Z');
  });

  it('reuses a supplied agent-owned tab for navigate instead of opening a new one', async () => {
    const automation = createStubBrowserAutomation({
      navigate: { 'https://example.com': { finalUrl: 'https://example.com', title: 'Example', status: 'loaded' } },
    });
    const tab = tagAgentOwnedTab('existing-tab');
    const request: BrowserToolRequest = { ...base, kind: 'navigate', url: 'https://example.com', tab };

    const outcome = await runBrowserToolRequest(request, automation, clock);
    expect(outcome.status).toBe('executed');
    const result = (outcome as Extract<typeof outcome, { status: 'executed' }>).result as { kind: 'navigate'; tab: unknown };
    expect(result.tab).toBe(tab);
  });

  it('never silently drops a blocked/error navigate reason', async () => {
    const automation = createStubBrowserAutomation({
      navigate: {
        'ftp://example.com': { finalUrl: 'ftp://example.com', title: '', status: 'blocked', reason: 'non-http(s) scheme' },
      },
    });
    const request: BrowserToolRequest = { ...base, kind: 'navigate', url: 'ftp://example.com' };

    const outcome = await runBrowserToolRequest(request, automation, clock);
    expect(outcome.status).toBe('executed');
    const result = (outcome as Extract<typeof outcome, { status: 'executed' }>).result as {
      status: string;
      reason?: string;
    };
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('non-http(s) scheme');
  });

  it('runs extract_page_data and passes through truncation/field metadata', async () => {
    const automation = createStubBrowserAutomation({
      extract: {
        'find the price': {
          sourceUrl: 'https://example.com',
          summary: '$19.99',
          fields: { price: '$19.99' },
          truncated: true,
          sourceLength: 50_000,
          status: 'ok',
        },
      },
    });
    const request: BrowserToolRequest = {
      ...base,
      kind: 'extract_page_data',
      instruction: 'find the price',
      tab: tagAgentOwnedTab('tab-1'),
    };

    const outcome = await runBrowserToolRequest(request, automation, clock);
    expect(outcome.status).toBe('executed');
    const result = (outcome as Extract<typeof outcome, { status: 'executed' }>).result as {
      summary: string;
      fields?: Record<string, string>;
      truncated: boolean;
      sourceLength: number;
      status: string;
      timestamp: string;
    };
    expect(result.summary).toBe('$19.99');
    expect(result.fields).toEqual({ price: '$19.99' });
    expect(result.truncated).toBe(true);
    expect(result.sourceLength).toBe(50_000);
    expect(result.status).toBe('ok');
    expect(result.timestamp).toBe('2026-07-26T14:03:00.000Z');
  });

  it('surfaces a refused extract_page_data result without throwing', async () => {
    const automation = createStubBrowserAutomation({
      extract: {
        'find the card number': {
          sourceUrl: 'https://checkout.example.com',
          summary: '',
          truncated: false,
          sourceLength: 0,
          status: 'refused',
        },
      },
    });
    const request: BrowserToolRequest = {
      ...base,
      kind: 'extract_page_data',
      instruction: 'find the card number',
      tab: tagAgentOwnedTab('tab-1'),
    };

    const outcome = await runBrowserToolRequest(request, automation, clock);
    expect(outcome.status).toBe('executed');
    const result = (outcome as Extract<typeof outcome, { status: 'executed' }>).result as { status: string };
    expect(result.status).toBe('refused');
  });

  it('blocks navigate inside a user-opened tab pending confirmation, without touching automation', async () => {
    const automation = unreachableAutomation();
    const tab = tagUserOpenedTab('users-tab');
    const request: BrowserToolRequest = { ...base, kind: 'navigate', url: 'https://example.com', tab };

    const outcome = await runBrowserToolRequest(request, automation, clock);

    expect(outcome.status).toBe('awaiting-disclosure');
    const awaiting = outcome as Extract<typeof outcome, { status: 'awaiting-disclosure' }>;
    expect(awaiting.requestId).toBe('req-1');
    expect(awaiting.disclosure).toContain('tab you already had open');
    expect(automation.navigate).not.toHaveBeenCalled();
    expect(automation.openAgentOwnedTab).not.toHaveBeenCalled();
  });

  it('blocks extract_page_data inside a user-opened tab pending confirmation, without touching automation', async () => {
    const automation = unreachableAutomation();
    const tab = tagUserOpenedTab('users-tab');
    const request: BrowserToolRequest = {
      ...base,
      kind: 'extract_page_data',
      instruction: 'find the price',
      tab,
    };

    const outcome = await runBrowserToolRequest(request, automation, clock);

    expect(outcome.status).toBe('awaiting-disclosure');
    const awaiting = outcome as Extract<typeof outcome, { status: 'awaiting-disclosure' }>;
    expect(awaiting.disclosure).toContain('tab you already had open');
    expect(automation.extract).not.toHaveBeenCalled();
  });
});

describe('runConfirmedBrowserToolRequest', () => {
  it('executes a previously-blocked navigate once the human confirms', async () => {
    const automation = createStubBrowserAutomation({
      navigate: { 'https://example.com': { finalUrl: 'https://example.com', title: 'Example', status: 'loaded' } },
    });
    const tab = tagUserOpenedTab('users-tab');
    const request: BrowserToolRequest = { ...base, kind: 'navigate', url: 'https://example.com', tab };

    const outcome = await runConfirmedBrowserToolRequest(request, { confirmed: true }, automation, clock);

    expect(outcome.status).toBe('executed');
    const result = (outcome as Extract<typeof outcome, { status: 'executed' }>).result as { kind: string; tab: unknown };
    expect(result.kind).toBe('navigate');
    expect(result.tab).toBe(tab);
  });

  it('executes a previously-blocked extract_page_data once the human confirms', async () => {
    const automation = createStubBrowserAutomation({
      extract: {
        'find the price': {
          sourceUrl: 'https://example.com',
          summary: '$19.99',
          truncated: false,
          sourceLength: 100,
          status: 'ok',
        },
      },
    });
    const tab = tagUserOpenedTab('users-tab');
    const request: BrowserToolRequest = {
      ...base,
      kind: 'extract_page_data',
      instruction: 'find the price',
      tab,
    };

    const outcome = await runConfirmedBrowserToolRequest(request, { confirmed: true }, automation, clock);

    expect(outcome.status).toBe('executed');
    const result = (outcome as Extract<typeof outcome, { status: 'executed' }>).result as { summary: string };
    expect(result.summary).toBe('$19.99');
  });

  it('declines a previously-blocked navigate when the human stays private, without touching automation', async () => {
    const automation = unreachableAutomation();
    const tab = tagUserOpenedTab('users-tab');
    const request: BrowserToolRequest = { ...base, kind: 'navigate', url: 'https://example.com', tab };

    const outcome = await runConfirmedBrowserToolRequest(request, { confirmed: false }, automation, clock);

    expect(outcome.status).toBe('declined');
    const declined = outcome as Extract<typeof outcome, { status: 'declined' }>;
    expect(declined.requestId).toBe('req-1');
    expect(declined.disclosure).toContain('tab you already had open');
    expect(automation.navigate).not.toHaveBeenCalled();
    expect(automation.openAgentOwnedTab).not.toHaveBeenCalled();
  });

  it('declines a previously-blocked extract_page_data when the human stays private, without touching automation', async () => {
    const automation = unreachableAutomation();
    const tab = tagUserOpenedTab('users-tab');
    const request: BrowserToolRequest = {
      ...base,
      kind: 'extract_page_data',
      instruction: 'find the price',
      tab,
    };

    const outcome = await runConfirmedBrowserToolRequest(request, { confirmed: false }, automation, clock);

    expect(outcome.status).toBe('declined');
    expect(automation.extract).not.toHaveBeenCalled();
  });

  it('executes search_web unconditionally regardless of confirmation, since it was never gated', async () => {
    const automation = createStubBrowserAutomation({
      search: { noisebound: { results: [] } },
    });
    const request: BrowserToolRequest = { ...base, kind: 'search_web', query: 'noisebound', maxResults: 5 };

    const outcome = await runConfirmedBrowserToolRequest(request, { confirmed: false }, automation, clock);

    expect(outcome.status).toBe('executed');
  });

  it('executes navigate against an agent-owned tab unconditionally regardless of confirmation', async () => {
    const automation = createStubBrowserAutomation({
      navigate: { 'https://example.com': { finalUrl: 'https://example.com', title: 'Example', status: 'loaded' } },
    });
    const request: BrowserToolRequest = {
      ...base,
      kind: 'navigate',
      url: 'https://example.com',
      tab: tagAgentOwnedTab('tab-1'),
    };

    const outcome = await runConfirmedBrowserToolRequest(request, { confirmed: false }, automation, clock);

    expect(outcome.status).toBe('executed');
  });
});
