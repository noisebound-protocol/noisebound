import { describe, expect, it } from 'vitest';
import { ethToWei } from '../wei.js';

describe('ethToWei', () => {
  it('converts a whole ETH amount', () => {
    expect(ethToWei('1')).toBe('1000000000000000000');
  });

  it('converts 0.001 ETH exactly', () => {
    expect(ethToWei('0.001')).toBe('1000000000000000');
  });

  it('converts 0.0001 ETH exactly', () => {
    expect(ethToWei('0.0001')).toBe('100000000000000');
  });

  it('converts sub-cent amounts without float drift', () => {
    expect(ethToWei('0.0000037')).toBe('3700000000000');
  });

  it('preserves full 18-digit precision for whole-plus-fraction amounts', () => {
    expect(ethToWei('1.000000000000000001')).toBe('1000000000000000001');
  });

  it('rejects amounts with more than 18 fractional digits', () => {
    expect(() => ethToWei('0.0000000000000000001')).toThrow();
  });

  it('rejects non-numeric input', () => {
    expect(() => ethToWei('some ETH')).toThrow();
  });
});
