import { describe, expect, it, vi } from 'vitest';
import type { OnChainExecutor, OnChainMoneyActionRequest } from '@noisebound/sigma-execute';
import { DEMO_SESSION_CAPABILITY } from '../demoSessionCapability';

const createEthersOnChainExecutor = vi.fn();
const resolveSessionKey = vi.fn();

vi.mock('@noisebound/sigma-execute', () => ({
  createEthersOnChainExecutor: (...args: unknown[]) => createEthersOnChainExecutor(...args),
}));

vi.mock('../sessionKeyRegistry', () => ({
  resolveSessionKey,
}));

const { createRealOnChainExecutor, executeRealOnChainAction } = await import(
  '../realOnChainExecutor'
);

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

describe('createRealOnChainExecutor', () => {
  it('builds the real ethers executor wired to the app session key registry', () => {
    const fakeExecutor = { send: vi.fn() } satisfies OnChainExecutor;
    createEthersOnChainExecutor.mockReturnValueOnce(fakeExecutor);

    const executor = createRealOnChainExecutor();

    expect(createEthersOnChainExecutor).toHaveBeenCalledWith(resolveSessionKey);
    expect(executor).toBe(fakeExecutor);
  });
});

describe('executeRealOnChainAction', () => {
  it('sends the request through the given executor with the caller-supplied session capability', async () => {
    const send = vi.fn().mockResolvedValue('0xdeadbeef');
    const executor: OnChainExecutor = { send };

    const txHash = await executeRealOnChainAction(REQUEST, executor, DEMO_SESSION_CAPABILITY);

    expect(send).toHaveBeenCalledWith(REQUEST, DEMO_SESSION_CAPABILITY);
    expect(txHash).toBe('0xdeadbeef');
  });
});
