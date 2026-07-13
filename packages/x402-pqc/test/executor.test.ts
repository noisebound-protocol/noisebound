import { describe, it, expect, beforeAll, vi } from 'vitest';
import { generatePQCKeypair } from '@noisebound/pqc-wallet';
import type { PQCKeypair } from '@noisebound/pqc-wallet';
import { issueCapabilityToken } from '../src/capability.js';
import { RevocationRegistry } from '../src/revocation.js';
import { executeScopedTransaction } from '../src/executor.js';

const executionAddress = '0x000000000000000000000000000000000000dEaD';

let granterKeypair: PQCKeypair;

beforeAll(() => {
  granterKeypair = generatePQCKeypair();
});

function mockSigner(address = executionAddress, chainId = 84532) {
  return {
    getAddress: vi.fn().mockResolvedValue(address),
    sendTransaction: vi.fn().mockResolvedValue({ hash: '0xdeadbeef' }),
    provider: {
      getNetwork: vi.fn().mockResolvedValue({ chainId: BigInt(chainId) }),
    },
  };
}

describe('executeScopedTransaction', () => {
  it('valid scoped action succeeds and broadcasts', async () => {
    const token = issueCapabilityToken(
      granterKeypair,
      'session-1',
      executionAddress,
      [{ type: 'sign-tx', maxAmountWei: '1000000000000000000' }],
      900,
    );
    const registry = new RevocationRegistry();
    const signer = mockSigner();

    const tx = { to: '0xabc', value: 500000000000000000n };
    const result = await executeScopedTransaction(token, signer as any, tx, registry);

    expect(signer.sendTransaction).toHaveBeenCalledWith(tx);
    expect(result).toEqual({ hash: '0xdeadbeef' });
  });

  it('out-of-scope action (amount over cap) is rejected before broadcast', async () => {
    const token = issueCapabilityToken(
      granterKeypair,
      'session-1',
      executionAddress,
      [{ type: 'sign-tx', maxAmountWei: '1000' }],
      900,
    );
    const registry = new RevocationRegistry();
    const signer = mockSigner();

    const tx = { to: '0xabc', value: 5000n };
    await expect(executeScopedTransaction(token, signer as any, tx, registry)).rejects.toThrow(
      'out of scope',
    );
    expect(signer.sendTransaction).not.toHaveBeenCalled();
  });

  it('expired token is rejected before broadcast', async () => {
    const token = issueCapabilityToken(
      granterKeypair,
      'session-1',
      executionAddress,
      [{ type: 'sign-tx', maxAmountWei: '1000000000000000000' }],
      -10,
    );
    const registry = new RevocationRegistry();
    const signer = mockSigner();

    const tx = { to: '0xabc', value: 1n };
    await expect(executeScopedTransaction(token, signer as any, tx, registry)).rejects.toThrow(
      'token expired',
    );
    expect(signer.sendTransaction).not.toHaveBeenCalled();
  });

  it('revoked token is rejected before broadcast', async () => {
    const token = issueCapabilityToken(
      granterKeypair,
      'session-1',
      executionAddress,
      [{ type: 'sign-tx', maxAmountWei: '1000000000000000000' }],
      900,
    );
    const registry = new RevocationRegistry();
    registry.revoke(token.tokenId, token.expiresAt);
    const signer = mockSigner();

    const tx = { to: '0xabc', value: 1n };
    await expect(executeScopedTransaction(token, signer as any, tx, registry)).rejects.toThrow(
      'token revoked',
    );
    expect(signer.sendTransaction).not.toHaveBeenCalled();
  });

  it('rejects when the execution signer does not match token.executionAddress', async () => {
    const token = issueCapabilityToken(
      granterKeypair,
      'session-1',
      executionAddress,
      [{ type: 'sign-tx', maxAmountWei: '1000000000000000000' }],
      900,
    );
    const registry = new RevocationRegistry();
    const wrongSigner = mockSigner('0x1111111111111111111111111111111111111a');

    const tx = { to: '0xabc', value: 1n };
    await expect(executeScopedTransaction(token, wrongSigner as any, tx, registry)).rejects.toThrow(
      'does not match',
    );
    expect(wrongSigner.sendTransaction).not.toHaveBeenCalled();
  });

  it('rejects when the execution signer is connected to the wrong network', async () => {
    const token = issueCapabilityToken(
      granterKeypair,
      'session-1',
      executionAddress,
      [{ type: 'sign-tx', maxAmountWei: '1000000000000000000' }],
      900,
    );
    const registry = new RevocationRegistry();
    // Test env is configured for base-sepolia (84532) — connect the signer to mainnet instead.
    const wrongNetworkSigner = mockSigner(executionAddress, 8453);

    const tx = { to: '0xabc', value: 1n };
    await expect(
      executeScopedTransaction(token, wrongNetworkSigner as any, tx, registry),
    ).rejects.toThrow('not connected to the active network');
    expect(wrongNetworkSigner.sendTransaction).not.toHaveBeenCalled();
  });
});