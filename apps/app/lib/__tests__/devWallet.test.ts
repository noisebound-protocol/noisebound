import { describe, expect, it } from 'vitest';
import type { SessionCapabilityScope } from '@noisebound/pqc-wallet';
import {
  computeDevSessionFundingWei,
  DEV_SESSION_GAS_BUFFER_WEI,
  DEV_SESSION_MAX_SCOPE_FUNDING_WEI,
} from '../fixtures/devWallet';

describe('computeDevSessionFundingWei', () => {
  it('funds the gas buffer plus the full scope for a small scope', () => {
    const scope: SessionCapabilityScope = { maxSpendWei: '1000000000000000' }; // 0.001 ETH
    expect(computeDevSessionFundingWei(scope)).toBe(
      DEV_SESSION_GAS_BUFFER_WEI + 1_000_000_000_000_000n,
    );
  });

  it('caps the scope-based funding for a large scope instead of pre-funding it in full', () => {
    const scope: SessionCapabilityScope = { maxSpendWei: (10n ** 18n).toString() }; // 1 ETH
    const funded = computeDevSessionFundingWei(scope);

    expect(funded).toBe(DEV_SESSION_GAS_BUFFER_WEI + DEV_SESSION_MAX_SCOPE_FUNDING_WEI);
    expect(funded).toBeLessThan(10n ** 18n);
  });

  it('always includes the gas buffer even for a zero-spend scope', () => {
    const scope: SessionCapabilityScope = { maxSpendWei: '0' };
    expect(computeDevSessionFundingWei(scope)).toBe(DEV_SESSION_GAS_BUFFER_WEI);
  });
});
