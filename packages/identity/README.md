# @noisebound/identity

ML-DSA-65 post-quantum identity key management for Noisebound.

This package generates ML-DSA-65 (Dilithium) keypairs and uses them to sign
and verify arbitrary byte payloads ("capability tokens"). It also provides
base64 serialization helpers so keypairs, public keys, and capability tokens
can be persisted or transported as strings. Signing and verification are
thin wrappers around `@noble/post-quantum`'s `ml_dsa65` implementation.

## API

### Types

- `IdentityKeyPair` — `{ publicKey: Uint8Array; secretKey: Uint8Array }`, an ML-DSA-65 keypair as raw bytes.
- `SerializedIdentityKeyPair` — `{ publicKey: string; secretKey: string }`, base64-encoded form of `IdentityKeyPair`.
- `CapabilityToken` — `{ payload: Uint8Array; signature: Uint8Array }`, a payload and its ML-DSA-65 signature.
- `SerializedCapabilityToken` — `{ payload: string; signature: string }`, base64-encoded form of `CapabilityToken`.

### Keypairs (`keypair.ts`)

- `generateIdentityKeyPair(): IdentityKeyPair` — generates a fresh ML-DSA-65 keypair (1952-byte public key, 4032-byte secret key).
- `serializeIdentityKeyPair(keyPair: IdentityKeyPair): SerializedIdentityKeyPair` — encodes a keypair as base64 strings for storage.
- `deserializeIdentityKeyPair(serialized: SerializedIdentityKeyPair): IdentityKeyPair` — decodes a base64-serialized keypair back into raw key bytes.
- `serializePublicKey(publicKey: Uint8Array): string` — encodes a public key as a base64 string.
- `deserializePublicKey(serialized: string): Uint8Array` — decodes a base64-encoded public key back into raw bytes.

### Capability tokens (`capability.ts`)

- `signCapabilityToken(secretKey: Uint8Array, payload: Uint8Array): CapabilityToken` — signs an arbitrary payload with an identity secret key, producing a capability token.
- `verifyCapabilityToken(publicKey: Uint8Array, payload: Uint8Array, signature: Uint8Array): boolean` — verifies a capability token's signature against an identity public key.
- `serializeCapabilityToken(token: CapabilityToken): SerializedCapabilityToken` — encodes a capability token as base64 strings for storage or transport.
- `deserializeCapabilityToken(serialized: SerializedCapabilityToken): CapabilityToken` — decodes a base64-serialized capability token back into raw bytes.

## Usage

```ts
import {
  generateIdentityKeyPair,
  signCapabilityToken,
  verifyCapabilityToken,
} from '@noisebound/identity';

const keyPair = generateIdentityKeyPair();
const payload = new TextEncoder().encode('capability:grant:session-42');

const token = signCapabilityToken(keyPair.secretKey, payload);
const isValid = verifyCapabilityToken(keyPair.publicKey, token.payload, token.signature);
// isValid === true; false if the payload is tampered with or checked against the wrong public key
```
