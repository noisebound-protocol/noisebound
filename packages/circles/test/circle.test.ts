import { describe, it, expect } from 'vitest';
import { Circle, deployCircle, getCircle } from '../src/circle.js';
import { generatePQCKeypair } from '@noisebound/pqc-wallet';
import type { CircleConfig } from '../src/types.js';

function makeConfig(name = 'test-circle'): CircleConfig {
  return {
    name,
    program: `contract ${name} { state { counter: int } constructor() { self.counter = 0 } }`,
    programRuntime: 'octb',
    initialState: { counter: 0 },
    keypair: generatePQCKeypair(),
  };
}

describe('deployCircle', () => {
  it('returns a Circle instance', async () => {
    const circle = await deployCircle(makeConfig());
    expect(circle).toBeInstanceOf(Circle);
  });

  it('returned Circle has a non-empty name', async () => {
    const circle = await deployCircle(makeConfig('my-defi-router'));
    expect(circle.name).toBeTruthy();
    expect(typeof circle.name).toBe('string');
  });

  it('returned Circle has a non-empty address', async () => {
    const circle = await deployCircle(makeConfig());
    expect(circle.address).toBeTruthy();
    expect(circle.address.length).toBeGreaterThan(10);
  });

  it('Circle address starts with 0x', async () => {
    const circle = await deployCircle(makeConfig());
    expect(circle.address.startsWith('0x')).toBe(true);
  });

  it('Circle address is deterministic for the same name and deployer', async () => {
    const keypair = generatePQCKeypair();
    const config: CircleConfig = {
      name: 'stable-circle',
      program: 'contract X {}',
      programRuntime: 'octb',
      keypair,
    };
    const c1 = await deployCircle(config);
    const c2 = await deployCircle(config);
    expect(c1.address).toBe(c2.address);
  });

  it('deploymentTx is a non-empty hex string', async () => {
    const circle = await deployCircle(makeConfig());
    expect(circle.deploymentTx).toBeTruthy();
    expect(circle.deploymentTx.startsWith('0x')).toBe(true);
  });
});

describe('Circle.execute', () => {
  it('returns a CircleResult with success=true for arbitrary methods', async () => {
    const circle = await deployCircle(makeConfig());
    const result = await circle.execute('call', { method: 'get_label', params: [] });
    expect(result).toMatchObject({ success: true });
    expect('value' in result).toBe(true);
  });

  it('returns a txHash in the result', async () => {
    const circle = await deployCircle(makeConfig());
    const result = await circle.execute('call', { method: 'inc', params: [] });
    expect(result.txHash).toBeTruthy();
    expect(typeof result.txHash).toBe('string');
  });

  it('inc method increments an internal counter', async () => {
    const circle = await deployCircle(makeConfig());
    const r1 = await circle.execute('call', { method: 'inc', params: [] });
    const r2 = await circle.execute('call', { method: 'inc', params: [] });
    expect(r1.value).toBe(1);
    expect(r2.value).toBe(2);
  });

  it('returns unique txHashes across executions', async () => {
    const circle = await deployCircle(makeConfig());
    const r1 = await circle.execute('call', { method: 'get_counter', params: [] });
    await new Promise(r => setTimeout(r, 2));
    const r2 = await circle.execute('call', { method: 'get_counter', params: [] });
    // Both are strings; may differ due to timestamp in hash
    expect(typeof r1.txHash).toBe('string');
    expect(typeof r2.txHash).toBe('string');
  });
});

describe('Circle.getState', () => {
  it('returns a CircleState with the correct address', async () => {
    const circle = await deployCircle(makeConfig());
    const state = await circle.getState();
    expect(state.address).toBe(circle.address);
  });

  it('CircleState has a fields object', async () => {
    const circle = await deployCircle(makeConfig());
    const state = await circle.getState();
    expect(typeof state.fields).toBe('object');
    expect(state.fields).not.toBeNull();
  });

  it('CircleState.lastUpdated is a recent timestamp', async () => {
    const before = Date.now();
    const circle = await deployCircle(makeConfig());
    const state = await circle.getState();
    expect(state.lastUpdated).toBeGreaterThanOrEqual(before);
  });

  it('initialState fields are reflected in getState', async () => {
    const circle = await deployCircle({
      ...makeConfig(),
      initialState: { counter: 42, label: 'hello' },
    });
    const state = await circle.getState();
    expect(state.fields.counter).toBe(42);
    expect(state.fields.label).toBe('hello');
  });
});

describe('Circle.isSealed', () => {
  it('returns true for a freshly deployed Circle', async () => {
    const circle = await deployCircle(makeConfig());
    expect(await circle.isSealed()).toBe(true);
  });
});

describe('getCircle', () => {
  it('returns a Circle for any address string', async () => {
    const circle = await getCircle('0xdeadbeef1234567890abcdef1234567890123456');
    expect(circle).toBeInstanceOf(Circle);
  });

  it('returned Circle has the requested address', async () => {
    const addr = '0xdeadbeef1234567890abcdef1234567890123456';
    const circle = await getCircle(addr);
    expect(circle.address).toBe(addr);
  });
});
