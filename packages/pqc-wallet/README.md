# @noisebound/pqc-wallet

Hybrid ML-DSA-65 identity / secp256k1 session-key signing for Noisebound.

An ML-DSA-65 identity keypair (from `@noisebound/identity`) does not sign transactions directly. Instead it issues short-lived **session capabilities**: ML-DSA-65-signed grants that authorize a freshly generated, ephemeral secp256k1 **session key** to sign and broadcast on-chain transactions within a defined spend/contract scope and expiry. This package provides the session-key generation, capability issuance/verification, revocation (in-memory and file-backed), balance lookups, and on-chain gas-funding needed to make that pattern work end to end, using `ethers` for chain interaction and `@noisebound/networks` for the active network's RPC config.

## API

### Session keys

- `generateSessionKey(): SessionKey` — generates a fresh, random (never deterministic) secp256k1 keypair for a session.

### Capabilities

- `issueSessionCapability(identityKeyPair, sessionPublicKey, scope, ttlMs): SessionCapability` — has an ML-DSA-65 identity key sign a capability binding `sessionPublicKey` to `scope` for `ttlMs` milliseconds.
- `verifySessionCapability(identityPublicKey, capability, registry?): boolean` — verifies a capability's signature and expiry, and (if a `RevocationRegistry` is passed) its revocation status.

### Revocation

- `createRevocationRegistry(): RevocationRegistry` — creates an in-memory set of revoked capability token ids.
- `revokeSessionCapability(registry, capability): void` — marks a capability's token id as revoked in a registry.
- `createPersistentRevocationRegistry(filePath): Promise<PersistentRevocationRegistry>` — loads/initializes a registry backed by an append-only JSON-lines file at `filePath`, replaying existing entries so revocations survive a process restart. `isRevoked` is a synchronous in-memory lookup; `revoke` is async because it appends to disk before updating memory.

### Balances

- `fetchNativeBalance(address): Promise<bigint>` — fetches the native (ETH) balance of an address on the currently active network.
- `fetchERC20Balance(address, tokenAddress): Promise<bigint>` — fetches an ERC-20 token balance of an address on the currently active network.

### Funding

- `fundSessionKey(funderWallet, sessionAddress, amountWei): Promise<`0x${string}`>` — sends a **real on-chain native-token transfer** from `funderWallet` to `sessionAddress` to gas-fund a new session key. Throws `SessionFundingError` on failure (e.g. insufficient balance, RPC error). Unlike the other functions in this package, this one is not pure/offline.
- `issueAndFundSessionCapability(identityKeyPair, sessionPublicKey, scope, ttlMs, funderWallet, amountWei): Promise<IssueAndFundResult>` — composes `issueSessionCapability` with `fundSessionKey`: issues the capability, then broadcasts a funding transaction to the new session address. If funding fails, the capability is discarded (issuance itself cannot fail).
- `SessionFundingError` — error thrown when an on-chain funding transfer fails.

### Types

- `SessionKey` — `{ address, publicKey, privateKey }`, a session's secp256k1 keypair.
- `SessionCapabilityScope` — `{ maxSpendWei, allowedContracts? }`, the spend/contract limits granted to a session key.
- `SessionCapabilityPayload` — `{ id, sessionAddress, sessionPublicKey, scope, issuedAt, expiresAt }`, the data an identity key attests to.
- `SessionCapability` — `{ payload, signature }`, an ML-DSA-65-signed grant.
- `RevocationRegistry` — `{ revoke(tokenId), isRevoked(tokenId) }` interface implemented by the in-memory registry.
- `PersistentRevocationRegistry` — same shape as `RevocationRegistry` but with an async `revoke`, implemented by the file-backed registry.
- `FunderWallet` — `{ privateKey }`, a wallet used to gas-fund newly issued session keys.
- `IssueAndFundResult` — `{ capability, fundingTxHash }`, the result of `issueAndFundSessionCapability`.

## Usage

```ts
import { generateIdentityKeyPair } from '@noisebound/identity';
import {
  generateSessionKey,
  issueSessionCapability,
  verifySessionCapability,
  createRevocationRegistry,
  revokeSessionCapability,
} from '@noisebound/pqc-wallet';

const identityKeyPair = generateIdentityKeyPair();
const sessionKey = generateSessionKey();

const capability = issueSessionCapability(
  identityKeyPair,
  sessionKey.publicKey,
  { maxSpendWei: '1000000000000000000' },
  60_000, // ttlMs
);

verifySessionCapability(identityKeyPair.publicKey, capability); // true

const registry = createRevocationRegistry();
revokeSessionCapability(registry, capability);
verifySessionCapability(identityKeyPair.publicKey, capability, registry); // false
```
