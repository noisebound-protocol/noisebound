import { describe, it, expect } from 'vitest';
import { VeilLMClient } from '../src/inference.js';
import type { DeFiContext } from '../src/types.js';

const ctx: DeFiContext = {
  availableProtocols: ['uniswap', 'aave', 'curve', 'lido'],
  userBalances: { ETH: '2.5', USDC: '1000', WBTC: '0.1' },
};

describe('VeilLMClient.query', () => {
  it('returns an InferenceResult with correct shape', async () => {
    const client = new VeilLMClient();
    const result = await client.query('swap 1 ETH for USDC on uniswap', ctx);
    expect(result).toMatchObject({
      confidence: expect.any(Number),
      rawResponse: expect.any(String),
      modelVersion: expect.any(String),
    });
    expect(result.intent).toBeDefined();
  });

  it('confidence is between 0 and 1', async () => {
    const client = new VeilLMClient();
    const result = await client.query('stake 2 ETH on lido', ctx);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('rawResponse is a non-empty string', async () => {
    const client = new VeilLMClient();
    const result = await client.query('lend 500 USDC on aave', ctx);
    expect(result.rawResponse.length).toBeGreaterThan(0);
  });

  it('modelVersion identifies the mock', async () => {
    const client = new VeilLMClient();
    const result = await client.query('bridge 1 ETH to arbitrum', ctx);
    expect(result.modelVersion).toContain('mock');
  });
});

describe('VeilLMClient.parseIntent — swap', () => {
  it('recognizes "swap X for Y"', async () => {
    const client = new VeilLMClient();
    const intent = await client.parseIntent('swap 1.5 ETH for USDC on uniswap');
    expect(intent.action).toBe('swap');
    expect(intent.fromToken).toBe('ETH');
    expect(intent.toToken).toBe('USDC');
  });

  it('captures amount from swap instruction', async () => {
    const client = new VeilLMClient();
    const intent = await client.parseIntent('swap 2.5 WBTC for ETH');
    expect(intent.amount?.trim()).toBe('2.5');
  });

  it('identifies uniswap as protocol', async () => {
    const client = new VeilLMClient();
    const intent = await client.parseIntent('swap ETH for USDC on uniswap');
    expect(intent.protocol).toBe('uniswap');
  });

  it('"exchange" keyword also maps to swap', async () => {
    const client = new VeilLMClient();
    const intent = await client.parseIntent('exchange 1 ETH for DAI');
    expect(intent.action).toBe('swap');
  });
});

describe('VeilLMClient.parseIntent — stake', () => {
  it('recognizes "stake X on Y"', async () => {
    const client = new VeilLMClient();
    const intent = await client.parseIntent('stake 2 ETH on lido');
    expect(intent.action).toBe('stake');
    expect(intent.fromToken).toBe('ETH');
    expect(intent.protocol).toBe('lido');
  });
});

describe('VeilLMClient.parseIntent — borrow', () => {
  it('recognizes "borrow X"', async () => {
    const client = new VeilLMClient();
    const intent = await client.parseIntent('borrow 1000 USDC on aave');
    expect(intent.action).toBe('borrow');
    expect(intent.toToken).toBe('USDC');
  });
});

describe('VeilLMClient.parseIntent — lend/supply', () => {
  it('recognizes "lend X"', async () => {
    const client = new VeilLMClient();
    const intent = await client.parseIntent('lend 500 USDC on aave');
    expect(intent.action).toBe('lend');
    expect(intent.fromToken).toBe('USDC');
  });

  it('recognizes "supply X"', async () => {
    const client = new VeilLMClient();
    const intent = await client.parseIntent('supply 0.5 ETH to compound');
    expect(intent.action).toBe('lend');
  });

  it('recognizes "deposit X"', async () => {
    const client = new VeilLMClient();
    const intent = await client.parseIntent('deposit 100 USDC on curve');
    expect(intent.action).toBe('lend');
    expect(intent.protocol).toBe('curve');
  });
});

describe('VeilLMClient.parseIntent — bridge', () => {
  it('recognizes "bridge X to Y"', async () => {
    const client = new VeilLMClient();
    const intent = await client.parseIntent('bridge 1 ETH to arbitrum');
    expect(intent.action).toBe('bridge');
  });

  it('identifies hop as bridge protocol', async () => {
    const client = new VeilLMClient();
    const intent = await client.parseIntent('bridge 0.5 ETH to optimism via hop');
    expect(intent.protocol).toBe('hop');
  });
});

describe('VeilLMClient.parseIntent — urgency', () => {
  it('defaults to low urgency', async () => {
    const client = new VeilLMClient();
    const intent = await client.parseIntent('swap ETH for USDC');
    expect(intent.urgency).toBe('low');
  });

  it('detects high urgency from "urgent"', async () => {
    const client = new VeilLMClient();
    const intent = await client.parseIntent('urgent swap 1 ETH for USDC');
    expect(intent.urgency).toBe('high');
  });

  it('detects high urgency from "asap"', async () => {
    const client = new VeilLMClient();
    const intent = await client.parseIntent('swap ETH for USDC asap');
    expect(intent.urgency).toBe('high');
  });
});

describe('VeilLMClient.parseIntent — unknown', () => {
  it('returns action=unknown for unrecognized instructions', async () => {
    const client = new VeilLMClient();
    const intent = await client.parseIntent('hello world');
    expect(intent.action).toBe('unknown');
  });

  it('unknown intent has lower confidence in query', async () => {
    const client = new VeilLMClient();
    const known = await client.query('swap ETH for USDC', ctx);
    const unknown = await client.query('hello world', ctx);
    expect(known.confidence).toBeGreaterThan(unknown.confidence);
  });
});
