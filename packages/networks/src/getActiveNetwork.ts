import { CHAIN_REGISTRY, isNetworkName, NETWORK_NAMES, type NetworkConfig } from './registry.js';

const ENV_VAR_NAME = 'NEXT_PUBLIC_NOISEBOUND_NETWORK';

export function getActiveNetwork(): NetworkConfig {
  const rawValue = process.env[ENV_VAR_NAME];

  if (rawValue === undefined || rawValue === '') {
    throw new Error(
      `${ENV_VAR_NAME} is not set. Valid options are: ${NETWORK_NAMES.join(', ')}`,
    );
  }

  if (!isNetworkName(rawValue)) {
    throw new Error(
      `${ENV_VAR_NAME}="${rawValue}" is not a valid network. Valid options are: ${NETWORK_NAMES.join(', ')}`,
    );
  }

  return CHAIN_REGISTRY[rawValue];
}
