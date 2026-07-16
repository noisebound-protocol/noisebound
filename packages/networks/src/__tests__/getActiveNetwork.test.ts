import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getActiveNetwork } from '../getActiveNetwork.js';

const ENV_VAR_NAME = 'NEXT_PUBLIC_NOISEBOUND_NETWORK';
const originalValue = process.env[ENV_VAR_NAME];

describe('getActiveNetwork', () => {
  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[ENV_VAR_NAME];
    } else {
      process.env[ENV_VAR_NAME] = originalValue;
    }
  });

  it('returns the base-mainnet config when the env var is set to base-mainnet', () => {
    process.env[ENV_VAR_NAME] = 'base-mainnet';

    expect(getActiveNetwork()).toEqual({
      chainId: 8453,
      rpcUrl: 'https://mainnet.base.org',
      usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      displayName: 'Base',
    });
  });

  it('returns the base-sepolia config when the env var is set to base-sepolia', () => {
    process.env[ENV_VAR_NAME] = 'base-sepolia';

    expect(getActiveNetwork()).toEqual({
      chainId: 84532,
      rpcUrl: 'https://sepolia.base.org',
      usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      displayName: 'Base Sepolia',
    });
  });

  it('throws an explicit error when the env var is unset', () => {
    delete process.env[ENV_VAR_NAME];

    expect(() => getActiveNetwork()).toThrowError(
      `${ENV_VAR_NAME} is not set. Valid options are: base-mainnet, base-sepolia`,
    );
  });

  it('throws an explicit error when the env var is an empty string', () => {
    process.env[ENV_VAR_NAME] = '';

    expect(() => getActiveNetwork()).toThrowError(
      `${ENV_VAR_NAME} is not set. Valid options are: base-mainnet, base-sepolia`,
    );
  });

  it('throws an explicit error when the env var is set to an invalid value', () => {
    process.env[ENV_VAR_NAME] = 'ethereum-mainnet';

    expect(() => getActiveNetwork()).toThrowError(
      `${ENV_VAR_NAME}="ethereum-mainnet" is not a valid network. Valid options are: base-mainnet, base-sepolia`,
    );
  });
});
