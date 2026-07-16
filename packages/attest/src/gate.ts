import type { AttestationVerificationResult } from './types.js';

/**
 * The single choke point a caller must go through before releasing any
 * decryption key or other sensitive payload to a cloud GPU provider.
 *
 * Returns `true` only if every check in `result` passed: valid signature,
 * a nonce matching the issued challenge (no replay), a fresh token, and
 * measurements matching the pinned known-good allowlist. Any single
 * failing check blocks release — this function intentionally does not
 * average or weight checks.
 */
export function shouldReleaseKey(result: AttestationVerificationResult): boolean {
  return (
    result.signatureValid &&
    result.nonceValid &&
    result.fresh &&
    result.measurementsMatch &&
    result.overallResult &&
    result.secureBootEnabled &&
    result.debugModeDisabled
  );
}
