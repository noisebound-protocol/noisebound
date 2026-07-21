import { describe, expect, it, vi } from 'vitest';
import type { IdentityKeyPair } from '@noisebound/identity';
import type {
  IssueAndFundResult,
  RevocationRegistry,
  SessionCapability,
  SessionCapabilityScope,
  SessionKey,
} from '@noisebound/pqc-wallet';

const mockSessionKey: SessionKey = {
  address: '0xsession0000000000000000000000000000abcd',
  publicKey: '0x04sessionpublickey',
  privateKey: '0xsessionprivatekey',
};

const mockIssueResult: IssueAndFundResult = {
  capability: {
    payload: {
      id: 'cap-1',
      sessionAddress: mockSessionKey.address,
      sessionPublicKey: mockSessionKey.publicKey,
      scope: { maxSpendWei: '1000' },
      issuedAt: 1000,
      expiresAt: 2000,
    },
    signature: new Uint8Array([1, 2, 3]),
  },
  fundingTxHash: '0xfundingtxhash',
};

const generateSessionKey = vi.fn(() => mockSessionKey);
const issueAndFundSessionCapability = vi.fn(async () => mockIssueResult);
const revokeSessionCapability = vi.fn();

vi.mock('@noisebound/pqc-wallet', () => ({
  generateSessionKey: (...args: unknown[]) => generateSessionKey(...(args as [])),
  issueAndFundSessionCapability: (...args: unknown[]) =>
    issueAndFundSessionCapability(...(args as [])),
  revokeSessionCapability: (...args: unknown[]) => revokeSessionCapability(...(args as [])),
}));

const computeDevSessionFundingWei = vi.fn(() => 2_000_000_000_000_000n);

vi.mock('../fixtures/devWallet', () => ({
  getDevFunderWallet: () => ({ privateKey: '0xfunderprivatekey' }),
  computeDevSessionFundingWei: (...args: unknown[]) =>
    computeDevSessionFundingWei(...(args as [])),
}));

const registerSessionKey = vi.fn();

vi.mock('../sessionKeyRegistry', () => ({
  registerSessionKey: (...args: unknown[]) => registerSessionKey(...(args as [])),
}));

const { issueNewSessionCapability, revokeStoredCapability } = await import('../sessionKeyActions');

const identityKeyPair: IdentityKeyPair = {
  publicKey: new Uint8Array([9, 9, 9]),
  secretKey: new Uint8Array([8, 8, 8]),
};

const scope: SessionCapabilityScope = { maxSpendWei: '5000000000000000' };
const ttlMs = 24 * 60 * 60 * 1000;

describe('issueNewSessionCapability', () => {
  it('generates a fresh session key and issues+funds a capability for its public key', async () => {
    const result = await issueNewSessionCapability(identityKeyPair, scope, ttlMs);

    expect(generateSessionKey).toHaveBeenCalledOnce();
    expect(computeDevSessionFundingWei).toHaveBeenCalledWith(scope);
    expect(issueAndFundSessionCapability).toHaveBeenCalledWith(
      identityKeyPair,
      mockSessionKey.publicKey,
      scope,
      ttlMs,
      { privateKey: '0xfunderprivatekey' },
      2_000_000_000_000_000n,
    );
    expect(result).toBe(mockIssueResult);
  });

  it('never leaks the generated session key private key into the result', async () => {
    const result = await issueNewSessionCapability(identityKeyPair, scope, ttlMs);
    expect(JSON.stringify(result)).not.toContain(mockSessionKey.privateKey);
  });

  it('registers the generated session key so the real executor can resolve it later', async () => {
    await issueNewSessionCapability(identityKeyPair, scope, ttlMs);
    expect(registerSessionKey).toHaveBeenCalledWith(mockSessionKey);
  });
});

describe('revokeStoredCapability', () => {
  it('delegates directly to revokeSessionCapability with the given registry and capability', () => {
    const registry = {} as RevocationRegistry;
    const capability = mockIssueResult.capability as SessionCapability;

    revokeStoredCapability(registry, capability);

    expect(revokeSessionCapability).toHaveBeenCalledWith(registry, capability);
  });
});
