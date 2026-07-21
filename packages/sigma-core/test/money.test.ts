import { describe, expect, it } from 'vitest';
import { ethToWei } from '../src/index.js';

describe('ethToWei', () => {
  it('converts a whole ETH amount', () => {
    expect(ethToWei('1')).toBe(1_000_000_000_000_000_000n);
  });

  it('converts a whole-plus-fraction amount exactly', () => {
    expect(ethToWei('2.5')).toBe(2_500_000_000_000_000_000n);
  });

  it('converts 0.001 ETH exactly', () => {
    expect(ethToWei('0.001')).toBe(1_000_000_000_000_000n);
  });

  it('converts 0.0001 ETH exactly (the amount that broke the evaluated models)', () => {
    expect(ethToWei('0.0001')).toBe(100_000_000_000_000n);
  });

  it('converts sub-cent amounts without float drift', () => {
    expect(ethToWei('0.0000037')).toBe(3_700_000_000_000n);
  });

  it('preserves full 18-digit precision for whole-plus-fraction amounts', () => {
    expect(ethToWei('1.000000000000000001')).toBe(1_000_000_000_000_000_001n);
  });

  it('converts zero', () => {
    expect(ethToWei('0')).toBe(0n);
  });

  it('tolerates surrounding whitespace', () => {
    expect(ethToWei('  0.25  ')).toBe(250_000_000_000_000_000n);
  });

  it('rejects amounts with more than 18 fractional digits', () => {
    expect(() => ethToWei('0.0000000000000000001')).toThrow();
  });

  it('rejects non-numeric input', () => {
    expect(() => ethToWei('some ETH')).toThrow();
  });

  it('rejects empty input', () => {
    expect(() => ethToWei('')).toThrow();
  });

  it('rejects negative amounts', () => {
    expect(() => ethToWei('-1')).toThrow();
  });

  it('rejects scientific notation', () => {
    expect(() => ethToWei('1e18')).toThrow();
  });

  it('rejects amounts with multiple decimal points', () => {
    expect(() => ethToWei('1.2.3')).toThrow();
  });
});
