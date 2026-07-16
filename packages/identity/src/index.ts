export type {
  IdentityKeyPair,
  SerializedIdentityKeyPair,
  CapabilityToken,
  SerializedCapabilityToken,
} from './types.js';

export {
  generateIdentityKeyPair,
  serializeIdentityKeyPair,
  deserializeIdentityKeyPair,
  serializePublicKey,
  deserializePublicKey,
} from './keypair.js';

export {
  signCapabilityToken,
  verifyCapabilityToken,
  serializeCapabilityToken,
  deserializeCapabilityToken,
} from './capability.js';
