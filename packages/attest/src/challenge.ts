import { randomBytes } from 'node:crypto';
import type { Clock } from './clock.js';
import type { AttestationChallenge } from './types.js';

/**
 * Generates a fresh, unpredictable nonce for the attestation
 * challenge-response flow. The caller sends this nonce to the device being
 * attested; the resulting attestation report (and its token) must echo it
 * back in the `eat_nonce` claim. Verifying that echo (see
 * {@link verifyAttestationToken} in `verify.ts`) is what prevents an old,
 * previously-valid token from being replayed against a new request.
 *
 * 32 random bytes hex-encoded yields a 64-character nonce, comfortably
 * within the EAT nonce length bounds (8-88 chars for JSON-encoded EATs).
 */
export function generateAttestationChallenge(
  clock: Clock,
  randomBytesFn: (size: number) => Buffer = randomBytes,
): AttestationChallenge {
  return {
    nonce: randomBytesFn(32).toString('hex'),
    issuedAtMs: clock.now().getTime(),
  };
}
