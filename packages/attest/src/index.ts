export type { Clock } from './clock.js';
export { SystemClock } from './clock.js';

export type {
  EnclaveTechnology,
  DeviceType,
  EnclaveMeasurement,
  EnclaveIdentity,
  AttestationTokenClaims,
  AttestationToken,
  ExpectedMeasurement,
  MeasurementAllowlist,
  AttestationChallenge,
  AttestationVerificationResult,
} from './types.js';

export { generateAttestationChallenge } from './challenge.js';

export type { SignatureVerifier, VerifyAttestationTokenOptions } from './verify.js';
export { verifyAttestationToken, isAttestationFresh } from './verify.js';

export { shouldReleaseKey } from './gate.js';

export {
  DEFAULT_MOCK_MEASUREMENT,
  buildMockEnclaveIdentity,
  buildMockClaims,
  signMockToken,
  createMockSignatureVerifier,
} from './testing.js';
