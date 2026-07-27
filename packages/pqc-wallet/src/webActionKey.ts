import { webcrypto } from 'node:crypto';
import type { WebActionKey } from './types.js';

/** Generates a fresh random ephemeral ECDSA P-256 subject key for a web-action capability. Never deterministically derived. */
export async function generateWebActionKey(): Promise<WebActionKey> {
  const keyPair = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );

  const [publicKeyBytes, privateKeyBytes] = await Promise.all([
    webcrypto.subtle.exportKey('raw', keyPair.publicKey),
    webcrypto.subtle.exportKey('pkcs8', keyPair.privateKey),
  ]);

  return {
    publicKey: Buffer.from(publicKeyBytes).toString('base64'),
    privateKey: Buffer.from(privateKeyBytes).toString('base64'),
  };
}
