import { RSABSSA } from '@cloudflare/blindrsa-ts';
import { sha256 } from './encoding.js';
import type { CryptoKey } from './types.js';

/**
 * RFC 9578 §6.1 requires one of RSABSSA-SHA384-PSS-Deterministic or
 * RSABSSA-SHA384-PSSZERO-Deterministic for publicly verifiable (Token Type
 * 0x0002) tokens; we use the former. "Deterministic" means the message is
 * blinded without a random prefix, so the token's content — not extra
 * entropy either party could inject — is what's authenticated.
 */
export const suite = RSABSSA.SHA384.PSS.Deterministic();

/** RFC 9578 §6.5: token_key_id = SHA256(DER-encoded SubjectPublicKeyInfo). */
export async function computeTokenKeyId(publicKey: CryptoKey): Promise<Uint8Array> {
  const spki = await crypto.subtle.exportKey('spki', publicKey);
  return sha256(new Uint8Array(spki));
}
