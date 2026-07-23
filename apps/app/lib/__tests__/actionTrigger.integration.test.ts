import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ActionRequest } from '@noisebound/sigma-execute';
import { evaluateActionRequest } from '../actionTrigger';
import { createPersistedRecipientHistory } from '../recipientHistoryStore';

/**
 * Integration coverage for the real send flow's novelty gate: evaluateActionRequest
 * (the exact function apps/app's send action trigger calls) wired to a real
 * file-backed RecipientHistory, not the in-memory reference implementation.
 */
describe('evaluateActionRequest wired to a persisted recipient history', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'noisebound-recipient-history-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  function buildRequest(overrides: Partial<ActionRequest> = {}): ActionRequest {
    return {
      kind: 'on-chain-money',
      id: 'action-money-1',
      description: 'Send rent payment',
      amountCents: 150_000,
      currency: 'USD',
      amountWei: 500_000_000_000_000_000n,
      recipient: '0x4f2a1b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a',
      asset: 'ETH',
      ...overrides,
    } as ActionRequest;
  }

  it('escalates the first send to a new address, then lets a repeat send through without re-escalating', async () => {
    const historyPath = join(dataDir, 'recipient-history.json');
    const history = createPersistedRecipientHistory(historyPath);
    const request = buildRequest();

    const first = evaluateActionRequest(request, history);
    expect(first.status).toBe('requires-secondary-confirmation');

    const second = evaluateActionRequest(request, history);
    expect(second.status).toBe('awaiting-confirmation');
  });

  it('persists the seen recipient across a simulated process restart (fresh history instance, same file)', async () => {
    const historyPath = join(dataDir, 'recipient-history.json');
    const request = buildRequest();

    const firstProcessHistory = createPersistedRecipientHistory(historyPath);
    const first = evaluateActionRequest(request, firstProcessHistory);
    expect(first.status).toBe('requires-secondary-confirmation');

    const secondProcessHistory = createPersistedRecipientHistory(historyPath);
    const second = evaluateActionRequest(request, secondProcessHistory);
    expect(second.status).toBe('awaiting-confirmation');
  });
});
