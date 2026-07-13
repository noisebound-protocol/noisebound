import { describe, it, expect } from 'vitest';
import { CircleSession, CircleSessionError } from '../src/session.js';
import { VeilLMClient } from '../src/inference.js';
import { Circle } from '../src/circle.js';
import { fhe_load_pk } from '../src/fhe.js';
import { generatePQCKeypair } from '@noisebound/pqc-wallet';
import type { DeFiContext, SessionConfig } from '../src/types.js';

const ctx: DeFiContext = {
  availableProtocols: ['uniswap', 'aave', 'lido'],
  userBalances: { ETH: '2.0', USDC: '500' },
};

function makeConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return { keypair: generatePQCKeypair(), ...overrides };
}

// ─── CircleSession lifecycle ──────────────────────────────────────────────────

describe('CircleSession lifecycle', () => {
  it('isActive is false before create()', () => {
    const session = new CircleSession(makeConfig());
    expect(session.isActive).toBe(false);
  });

  it('circle is undefined before create()', () => {
    const session = new CircleSession(makeConfig());
    expect(session.circle).toBeUndefined();
  });

  it('fhePublicKey is undefined before create()', () => {
    const session = new CircleSession(makeConfig());
    expect(session.fhePublicKey).toBeUndefined();
  });

  it('create() sets isActive to true', async () => {
    const session = new CircleSession(makeConfig());
    await session.create();
    expect(session.isActive).toBe(true);
    await session.teardown();
  });

  it('create() sets circle to a Circle instance', async () => {
    const session = new CircleSession(makeConfig());
    await session.create();
    expect(session.circle).toBeInstanceOf(Circle);
    await session.teardown();
  });

  it('create() sets fhePublicKey with ckks-mock algorithm', async () => {
    const session = new CircleSession(makeConfig());
    await session.create();
    expect(session.fhePublicKey).toBeDefined();
    expect(session.fhePublicKey?.algorithm).toBe('ckks-mock');
    await session.teardown();
  });

  it('create() is idempotent — second call is a no-op', async () => {
    const session = new CircleSession(makeConfig());
    await session.create();
    const circle1 = session.circle;
    await session.create();      // should not replace the Circle
    expect(session.circle).toBe(circle1);
    await session.teardown();
  });

  it('accepts custom fhePkBytes and uses them as the public key', async () => {
    const customPk = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    const session = new CircleSession(makeConfig({ fhePkBytes: customPk }));
    await session.create();
    const expectedKeyId = fhe_load_pk(customPk).keyId;
    expect(session.fhePublicKey?.keyId).toBe(expectedKeyId);
    await session.teardown();
  });
});

// ─── CircleSession teardown ───────────────────────────────────────────────────

describe('CircleSession teardown', () => {
  it('teardown sets isActive to false', async () => {
    const session = new CircleSession(makeConfig());
    await session.create();
    await session.teardown();
    expect(session.isActive).toBe(false);
  });

  it('teardown with reuse=false clears circle', async () => {
    const session = new CircleSession(makeConfig({ reuse: false }));
    await session.create();
    await session.teardown();
    expect(session.circle).toBeUndefined();
  });

  it('teardown with reuse=false clears fhePublicKey', async () => {
    const session = new CircleSession(makeConfig({ reuse: false }));
    await session.create();
    await session.teardown();
    expect(session.fhePublicKey).toBeUndefined();
  });

  it('teardown with reuse=true preserves circle', async () => {
    const session = new CircleSession(makeConfig({ reuse: true }));
    await session.create();
    const circle = session.circle;
    await session.teardown();
    expect(session.circle).toBe(circle);
  });

  it('teardown with reuse=true preserves fhePublicKey', async () => {
    const session = new CircleSession(makeConfig({ reuse: true }));
    await session.create();
    const pk = session.fhePublicKey;
    await session.teardown();
    expect(session.fhePublicKey).toBe(pk);
  });

  it('teardown + create() re-activates the session', async () => {
    const session = new CircleSession(makeConfig());
    await session.create();
    await session.teardown();
    await session.create();
    expect(session.isActive).toBe(true);
    await session.teardown();
  });
});

// ─── encryptQuery / decryptResult ────────────────────────────────────────────

describe('CircleSession.encryptQuery', () => {
  it('throws CircleSessionError if session is not active', async () => {
    const session = new CircleSession(makeConfig());
    await expect(session.encryptQuery('swap ETH for USDC', ctx)).rejects.toBeInstanceOf(
      CircleSessionError,
    );
  });

  it('returns a Uint8Array', async () => {
    const session = new CircleSession(makeConfig());
    await session.create();
    const encrypted = await session.encryptQuery('swap 1 ETH for USDC', ctx);
    expect(encrypted).toBeInstanceOf(Uint8Array);
    await session.teardown();
  });

  it('different prompts produce different ciphertexts', async () => {
    const session = new CircleSession(makeConfig());
    await session.create();
    const ct1 = await session.encryptQuery('swap ETH for USDC', ctx);
    const ct2 = await session.encryptQuery('stake 2 ETH on lido', ctx);
    expect(ct1).not.toEqual(ct2);
    await session.teardown();
  });
});

describe('CircleSession.decryptResult', () => {
  it('throws CircleSessionError if session is not active', async () => {
    const session = new CircleSession(makeConfig());
    const dummy = new Uint8Array(20);
    await expect(session.decryptResult(dummy)).rejects.toBeInstanceOf(CircleSessionError);
  });
});

// ─── private_predict ─────────────────────────────────────────────────────────

describe('CircleSession.private_predict', () => {
  it('throws CircleSessionError if session is not active', async () => {
    const session = new CircleSession(makeConfig());
    const dummy = new Uint8Array(20);
    await expect(session.private_predict(dummy)).rejects.toBeInstanceOf(CircleSessionError);
  });

  it('returns a Uint8Array', async () => {
    const session = new CircleSession(makeConfig());
    await session.create();
    const encrypted = await session.encryptQuery('swap 1 ETH for USDC on uniswap', ctx);
    const result = await session.private_predict(encrypted);
    expect(result).toBeInstanceOf(Uint8Array);
    await session.teardown();
  });

  it('result can be decrypted into a valid InferenceResult', async () => {
    const session = new CircleSession(makeConfig());
    await session.create();
    const encrypted = await session.encryptQuery('stake 2 ETH on lido', ctx);
    const resultBytes = await session.private_predict(encrypted);
    const result = await session.decryptResult(resultBytes);
    expect(result).toMatchObject({
      confidence: expect.any(Number),
      rawResponse: expect.any(String),
      modelVersion: expect.any(String),
    });
    expect(result.intent).toBeDefined();
    await session.teardown();
  });

  it('InferenceResult confidence is between 0 and 1', async () => {
    const session = new CircleSession(makeConfig());
    await session.create();
    const encrypted = await session.encryptQuery('lend 100 USDC on aave', ctx);
    const result = await session.decryptResult(await session.private_predict(encrypted));
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    await session.teardown();
  });

  it('modelVersion identifies the FHE mock path', async () => {
    const session = new CircleSession(makeConfig());
    await session.create();
    const encrypted = await session.encryptQuery('bridge 1 ETH to arbitrum', ctx);
    const result = await session.decryptResult(await session.private_predict(encrypted));
    expect(result.modelVersion).toContain('fhe');
    await session.teardown();
  });

  it('parses swap intent correctly through the FHE path', async () => {
    const session = new CircleSession(makeConfig());
    await session.create();
    const encrypted = await session.encryptQuery('swap 1.5 ETH for USDC on uniswap', ctx);
    const result = await session.decryptResult(await session.private_predict(encrypted));
    expect(result.intent.action).toBe('swap');
    expect(result.intent.fromToken).toBe('ETH');
    expect(result.intent.toToken).toBe('USDC');
    await session.teardown();
  });
});

// ─── Full flow tests ──────────────────────────────────────────────────────────

describe('CircleSession full flow', () => {
  it('create → encryptQuery → private_predict → decryptResult returns InferenceResult', async () => {
    const session = new CircleSession(makeConfig());
    await session.create();

    const encrypted = await session.encryptQuery('swap 2 ETH for USDC on uniswap', ctx);
    const resultBytes = await session.private_predict(encrypted);
    const result = await session.decryptResult(resultBytes);

    expect(result.intent.action).toBe('swap');
    expect(typeof result.confidence).toBe('number');
    expect(typeof result.rawResponse).toBe('string');

    await session.teardown();
  });

  it('VeilLMClient.query routes through CircleSession when sessionConfig is provided', async () => {
    const client = new VeilLMClient(undefined, makeConfig());
    const result = await client.query('swap 1 ETH for USDC on uniswap', ctx);

    expect(result.intent.action).toBe('swap');
    expect(result.modelVersion).toContain('fhe');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('VeilLMClient.query without sessionConfig uses mock path (modelVersion has "mock")', async () => {
    const client = new VeilLMClient();
    const result = await client.query('swap 1 ETH for USDC on uniswap', ctx);
    expect(result.modelVersion).toContain('mock');
  });

  it('VeilLMClient.private_predict requires sessionConfig', async () => {
    const client = new VeilLMClient();
    await expect(client.private_predict(new Uint8Array(20))).rejects.toThrow(
      'sessionConfig required',
    );
  });

  it('VeilLMClient.private_predict with sessionConfig returns Uint8Array', async () => {
    const keypair = generatePQCKeypair();
    const config = makeConfig({ keypair });
    const session = new CircleSession(config);
    await session.create();
    const encrypted = await session.encryptQuery('stake 1 ETH on lido', ctx);
    await session.teardown();

    const client = new VeilLMClient(undefined, config);
    const result = await client.private_predict(encrypted);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });
});

// ─── Graceful failure ─────────────────────────────────────────────────────────

describe('CircleSession graceful failure', () => {
  it('CircleSessionError has name="CircleSessionError"', () => {
    const err = new CircleSessionError('test');
    expect(err.name).toBe('CircleSessionError');
  });

  it('CircleSessionError is an instance of Error', () => {
    expect(new CircleSessionError('oops')).toBeInstanceOf(Error);
  });

  it('falls back correctly when Circle mock always succeeds (Octra unreachable)', async () => {
    // Circle.execute() is always mocked — this verifies we gracefully handle the
    // "no real Octra connection" path and still return a correctly shaped result.
    const session = new CircleSession(makeConfig());
    await session.create();
    const encrypted = await session.encryptQuery('borrow 1000 USDC on aave', ctx);
    const resultBytes = await session.private_predict(encrypted);
    const result = await session.decryptResult(resultBytes);

    expect(result.intent.action).toBe('borrow');
    expect(result.modelVersion).toContain('fhe');
    await session.teardown();
  });
});
