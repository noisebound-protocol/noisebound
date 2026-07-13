# @noisebound/pqc-wallet
ML-DSA-65 signing and ML-KEM-768 key encapsulation
for quantum-resistant wallets on Base.
Built by Veil Foundation — https://veilprotocol.net

## Install
npm install @noisebound/pqc-wallet

## Usage
import { generatePQCKeypair, signTransaction } from '@noisebound/pqc-wallet'
const { publicKey, privateKey } = await generatePQCKeypair()
const signature = await signTransaction(tx, privateKey)

## Why
ECDSA is vulnerable to Shor's algorithm on quantum computers.
ML-DSA-65 (FIPS 204) is NIST-standardized quantum-resistant.
Veil uses it for every transaction signature.

## Advanced API

### Signature verification

**`verifyTransactionSignature(tx, signature, publicKey)`** → `boolean`
Verifies an ML-DSA-65 signature over a serialized EVM transaction (keccak256 hash).

### Key encapsulation (ML-KEM-768)

**`encapsulateKey(recipientPublicKey)`** → `{ ciphertext: Uint8Array, sharedSecret: Uint8Array }`
Encapsulates a shared secret for a recipient; send `ciphertext` to the recipient — both sides derive the same `sharedSecret`.

**`decapsulateKey(ciphertext, encapsulationKey)`** → `Uint8Array`
Recovers the shared secret from a ciphertext produced by `encapsulateKey`.

### x402 payment headers

**`createX402PQCHeader(amount, recipient, signingKey)`** → `string`
Creates a base64-encoded x402 payment header (version, amount, recipient, timestamp, nonce) signed with ML-DSA-65. Any field tampering invalidates the signature.

**`verifyX402PQCHeader(headerB64, publicKey)`** → `boolean`
Verifies a PQC-signed x402 payment header produced by `createX402PQCHeader`.

### ethers.js signer

**`WalletProvider`** — `extends AbstractSigner`
ethers.js signer backed by ML-DSA-65. Implements `signMessage`, `signTransaction`, and `signTypedData`. Targets PQC-capable chains or rollups that accept ML-DSA-65 signatures; returned signature bytes are not EVM-serialized and will not be accepted by standard secp256k1 chains.

```typescript
import { WalletProvider } from '@noisebound/pqc-wallet'
const signer = new WalletProvider(keypair, provider)
const sig = await signer.signMessage('hello')
```

## License
Apache 2.0