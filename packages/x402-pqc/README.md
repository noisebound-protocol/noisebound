# @noisebound/x402-pqc

Quantum-resistant x402 payment protocol. Drop-in for AI agents and developers who need post-quantum payment headers without trusting ECDSA.

x402-pqc replaces ECDSA with **ML-DSA-65** for payment header signing and adds **ML-KEM-768** for optional payment channel encryption. It is a superset of the [x402 spec](https://x402.org) — x402-pqc headers contain all the same semantic fields, just quantum-resistant.

## Two modes

| Mode | Handshake | Per-payment | Header size | Best for |
|------|-----------|-------------|-------------|----------|
| **Base** | — | ML-DSA-65 sign (≈3.3 KB) | ~14 KB (hex) | One-off payments, auditable |
| **Session** | ML-DSA-65 × 2 + ML-KEM-768 | HMAC-SHA256 (~350 B) | < 500 B | High-frequency agent payments |

The session handshake (one-time cost) establishes a shared 32-byte key via ML-KEM-768. All subsequent payments in that session use HMAC-SHA256 — symmetric throughput comparable to plain HTTP headers.

### Performance vs ECDSA (from x402-pqc spec)

| | ECDSA | x402-pqc base | x402-pqc session |
|---|---|---|---|
| Key size | 32 B | 1952 B (DSA pk) | session key 32 B |
| Signature size | 64 B | 3309 B | 32 B (HMAC) |
| Sign latency | ~0.1 ms | ~5 ms | <0.1 ms |
| Quantum-safe | ✗ | ✓ | ✓ |

## Install

```bash
npm install @noisebound/x402-pqc
```

## Quick start — agent payment in 5 lines

```ts
import { generatePQCKeypair } from '@noisebound/pqc-wallet';
import { createX402PQCHeader, verifyX402PQCHeader } from '@noisebound/x402-pqc';

const keypair = generatePQCKeypair();
const header = createX402PQCHeader({ amount: '0.01', recipient: '0xABCD…', network: 'base' }, keypair);
const result = verifyX402PQCHeader(header);
// result.valid === true, result.payer === keypair.address
```

## Session mode — high-frequency payments

```ts
import { generatePQCKeypair } from '@noisebound/pqc-wallet';
import { createSession, confirmSession, deriveSessionKey, createSessionPayment, verifySessionPayment } from '@noisebound/x402-pqc';

// --- handshake (done once) ---
const payer  = generatePQCKeypair();
const payee  = generatePQCKeypair();

const sessionOpen   = createSession(payer, payee.publicKey.kem);
const confirmation  = confirmSession(sessionOpen, payee);
const sessionKey    = deriveSessionKey(sessionOpen, confirmation, payer.encapsulationKey);

// --- per-payment (HMAC only, < 500 B) ---
const header = createSessionPayment({ amount: '0.001', recipient: payee.address, network: 'base' }, sessionKey, sessionOpen.sessionId);
const result = verifySessionPayment(header, sessionKey);
// result.valid === true
```

## Optional payload encryption

```ts
import { generatePQCKeypair } from '@noisebound/pqc-wallet';
import { encryptPaymentMetadata, decryptPaymentMetadata } from '@noisebound/x402-pqc';

const payee = generatePQCKeypair();
const enc = encryptPaymentMetadata({ invoiceId: 'inv-001', tags: ['api'] }, payee.publicKey.kem);
const dec = decryptPaymentMetadata(enc, payee.encapsulationKey);
```

## Replay prevention

`verifyX402PQCHeader` checks the timestamp is within ±300 seconds of now.

For session payments, `verifySessionPayment` maintains an internal `NonceStore` to reject replays. For base headers you should deploy your own persistent store:

```ts
import { NonceStore } from '@noisebound/x402-pqc';

const store = new NonceStore(600); // 10-minute TTL
// Before accepting a payment:
if (!store.checkAndStoreNonce(nonce)) throw new Error('replay detected');
```

> **Production note:** `NonceStore` is in-memory. Multi-instance deployments must use a shared persistent store (Redis, Postgres) keyed by nonce.

## Spec

Full specification: [x402-pqc spec v0.1.0](https://veil.xyz/specs/x402-pqc-v0.1.0)
