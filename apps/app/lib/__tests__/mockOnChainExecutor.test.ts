import { describe, expect, it } from 'vitest';
import type { OnChainMoneyActionRequest } from '@noisebound/sigma-execute';
import { createMockOnChainExecutor, executeMockOnChainAction } from '../mockOnChainExecutor';

const REQUEST: OnChainMoneyActionRequest = {
  kind: 'on-chain-money',
  id: 'send-1',
  description: 'Send 0.5 ETH to 0x1111111111111111111111111111111111111111',
  amountCents: 50,
  currency: 'ETH',
  amountWei: 500000000000000000n,
  recipient: '0x1111111111111111111111111111111111111111',
  asset: 'ETH',
};

describe('mockOnChainExecutor', () => {
  it('resolves a deterministic fake tx hash without touching real chain state', async () => {
    const executor = createMockOnChainExecutor();
    const txHash = await executeMockOnChainAction(REQUEST, executor);

    expect(txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await executeMockOnChainAction(REQUEST, executor)).toBe(txHash);
  });
});
