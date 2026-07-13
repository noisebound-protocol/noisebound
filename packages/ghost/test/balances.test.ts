import { describe, it, expect, vi } from 'vitest';

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      getBalance: vi.fn().mockResolvedValue(BigInt('2500000000000000000')), // 2.5 ETH
      readContract: vi.fn().mockResolvedValue(BigInt('100000000')),         // 100 USDC
    })),
  };
});

import { fetchBalances } from '../src/chain/balances.js';

describe('fetchBalances', () => {
  it('returns ETH and USDC balances formatted from mocked RPC responses', async () => {
    const result = await fetchBalances('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', 'https://mainnet.base.org');
    expect(result.ETH).toBe('2.5');
    expect(result.USDC).toBe('100');
  });
});
