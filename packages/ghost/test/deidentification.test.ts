import { describe, it, expect } from 'vitest';
import { DeidentificationPipeline } from '../src/crypto/DeidentificationPipeline.js';
import type { UserContext } from '../src/parser/types.js';

describe('DeidentificationPipeline', () => {
  const pipeline = new DeidentificationPipeline();

  it('deidentifies all pattern types and pre-seeds vault from context', () => {
    const context: UserContext = {
      address: '0xAbCd1234567890abcdef1234567890abcdef1234',
      network: 'base',
      // ETH=0 should NOT be pre-seeded; USDC and WETH are non-zero
      balances: { ETH: '0', USDC: '500', WETH: '1.5' },
    };

    // All five pattern types in one message
    const message = [
      'TX: 0xa5944a29db48086fed450a4c71033d223ad1e00af97c0c73311f64c16ca1c87d',
      'wallet: 0xAbCd1234567890abcdef1234567890abcdef1234',
      'ENS: vitalik.eth',
      'balance: 100 USDC',
      'price: $5000',
    ].join(' — ');

    const { sanitized, vault } = pipeline.deidentify(message, context);

    // TX hash scrubbed
    expect(sanitized).not.toContain('0xa5944a29db48086fed450a4c71033d223ad1e00af97c0c73311f64c16ca1c87d');
    expect(sanitized).toMatch(/\[TX_HASH_\d+\]/);

    // Wallet address scrubbed
    expect(sanitized).not.toContain('0xAbCd1234567890abcdef1234567890abcdef1234');
    expect(sanitized).toMatch(/\[WALLET_\d+\]/);

    // ENS name scrubbed
    expect(sanitized).not.toContain('vitalik.eth');
    expect(sanitized).toMatch(/\[ENS_\d+\]/);

    // Token amount scrubbed
    expect(sanitized).not.toContain('100 USDC');
    expect(sanitized).toMatch(/\[AMOUNT_\d+\]/);

    // USD amount scrubbed
    expect(sanitized).not.toContain('$5000');
    expect(sanitized).toMatch(/\[USD_\d+\]/);

    // Pre-seeded: context address appears in vault
    const walletEntry = Object.entries(vault).find(
      ([, v]) => v.toLowerCase() === context.address.toLowerCase(),
    );
    expect(walletEntry).toBeDefined();

    // Pre-seeded: non-zero USDC and WETH balances appear in vault
    const vaultValues = Object.values(vault);
    expect(vaultValues.some((v) => v.includes('500') && v.includes('USDC'))).toBe(true);
    expect(vaultValues.some((v) => v.includes('1.5') && v.includes('WETH'))).toBe(true);

    // Zero-balance ETH must not be pre-seeded
    expect(vaultValues.some((v) => v === '0 ETH' || v === '0ETH')).toBe(false);
  });

  it('TX hash pattern takes priority over wallet address pattern', () => {
    const context: UserContext = { address: '0x0000000000000000000000000000000000000000', network: 'base', balances: {} };
    const txHash = '0xa5944a29db48086fed450a4c71033d223ad1e00af97c0c73311f64c16ca1c87d';
    const { sanitized } = pipeline.deidentify(txHash, context);

    expect(sanitized).toMatch(/\[TX_HASH_\d+\]/);
    // A TX hash (64 hex) must not be split into a wallet placeholder (40 hex)
    expect(sanitized).not.toMatch(/\[WALLET_\d+\]/);
  });

  it('reidentify restores all values and handles longest-first ordering', () => {
    const vault = {
      '[WALLET_0]': '0x1111111111111111111111111111111111111111',
      '[WALLET_10]': '0x2222222222222222222222222222222222222222',
    };

    const sanitized = 'From [WALLET_10] to [WALLET_0]';
    const result = pipeline.reidentify(sanitized, vault);

    expect(result).toBe(
      'From 0x2222222222222222222222222222222222222222 to 0x1111111111111111111111111111111111111111',
    );
    expect(result).not.toContain('[WALLET_');
  });

  it('bare numeric amounts without a token suffix are not stripped', () => {
    const context: UserContext = { address: '0x0000000000000000000000000000000000000001', network: 'base', balances: {} };
    const { sanitized } = pipeline.deidentify('transfer 42 tokens to my account', context);
    // "42" has no known token suffix — must pass through unchanged
    expect(sanitized).toContain('42');
  });
});
