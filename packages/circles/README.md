# @noisebound/circles

Octra Circle interface for private agent execution.

Circles are sealed FHE (Fully Homomorphic Encryption) execution environments on the [Octra blockchain](https://octra.org). Computation inside a Circle happens encrypted — no node in the network can observe inputs, outputs, or intermediate state.

Veil uses Circles for three things:

1. **Agent instruction execution** — private multi-step DeFi routing that no observer can reconstruct
2. **Key management** — PQC keypairs (ML-DSA-65 + ML-KEM-768) managed inside FHE environments
3. **VeilLM inference** — agent queries processed privately across nodes

---

## Current status (honest)

| Feature | Status |
|---|---|
| Octra testnet RPC (`getBalance`, `getNetworkInfo`) | **Real** — hits `https://octra.network` |
| Transaction signing (ML-DSA-65 layer) | **Real** — PQC identity layer over Octra wire format |
| Circle deployment | **Mocked** — requires `light-node` CLI, no REST API yet |
| Circle execution (`program.call` / `program.view`) | **Mocked** — browser-native API, no Node.js path yet |
| VeilLM inference | **Mocked** — distributed inference network not yet live |
| Spending limit enforcement | **Real** — in TypeScript before Circle layer |

This follows the same pattern as the source project's ZK mock (Veil's `@veil_/auth` package, not migrated here): the interface is complete and correct so downstream code can be built and tested today. When Octra's SDK ships a Node.js deploy path and `program.call` becomes accessible remotely, the mocks become real by filling in the TODO sections.

---

## Architecture

```
User instruction (natural language)
        │
        ▼
VeilLMClient.parseIntent()          ← mocked; will be Circle inference
        │
        ▼
AgentCircle.executeInstruction()    ← spending limits enforced here (real)
        │
        ▼
AgentCircle.submitExecution()       ← Circle.execute() mocked
        │
        ▼
Octra Circle (sealed FHE env)       ← window.OctraCircle.request() browser API
        │
        ▼
DeFi protocol (Uniswap, Aave, ...)
```

### PQC + Octra integration

```
@noisebound/pqc-wallet                @noisebound/circles               Octra testnet
─────────────────               ─────────────               ─────────────
generatePQCKeypair()     ──►    OctraClient(url, keypair)
                                    │
                                    ├── getNetworkInfo()  ──►  GET /staging
                                    ├── getBalance(addr)  ──►  GET /balance/{addr}
                                    └── sendTransaction() ──►  POST /send-tx
                                             │
                                        ML-DSA-65 sign (PQC identity layer)
                                        TODO: Ed25519 for vanilla testnet compat
```

### Circle deployment (today vs. when Octra SDK ships)

**Today**: circle.json + program source → compile via `octra build` → deploy via `light-node`. The deploy receipt contains the Circle address. `deployCircle()` mocks this and returns a Circle handle with a deterministic address.

**When SDK ships**: replace the `TODO` in `circle.ts:deployCircle()` with a Node.js SDK call. The returned `Circle` type and all downstream code stays identical.

---

## Usage

```typescript
import { OctraClient, createAgentCircle, OCTRA_TESTNET_URL } from '@noisebound/circles';
import { generatePQCKeypair } from '@noisebound/pqc-wallet';

// Create an Octra RPC client
const keypair = generatePQCKeypair();
const client = new OctraClient(OCTRA_TESTNET_URL, keypair);

// Check testnet connectivity
const info = await client.getNetworkInfo();
console.log(`Testnet reachable: ${info.reachable}, latency: ${info.latencyMs}ms`);

// Get balance (returns μOCT — 1 OCT = 1_000_000 μOCT)
const balance = await client.getBalance(keypair.address);
console.log(`Balance: ${balance / 1_000_000n} OCT`);

// Create an agent Circle with spending limits
const agent = await createAgentCircle({
  agentId: 'my-defi-agent',
  allowedProtocols: ['uniswap', 'aave'],
  spendingLimits: {
    maxPerTx: 100_000_000n,    // 100 OCT
    maxPerDay: 1_000_000_000n, // 1000 OCT
    maxTotal: 10_000_000_000n, // 10,000 OCT
  },
  keypair,
});

// Parse a natural language instruction into an execution plan
const plan = await agent.executeInstruction('swap 1 ETH for USDC on uniswap');
console.log(`Plan: ${plan.steps.length} steps, ~${plan.estimatedCost} μOCT`);

// Submit for execution (respects spending limits)
const result = await agent.submitExecution(plan);
console.log(`Executed: txHashes=${result.txHashes}`);
```

---

## What becomes real as Octra SDK matures

1. **`deployCircle()` in `circle.ts`** — replace the `TODO` body with an Octra SDK deploy call. The function signature and return type stay the same.

2. **`Circle.execute()` in `circle.ts`** — replace the mock with a call to Octra's Node.js RPC path for `program.call` / `program.view` (currently only available in the browser via `window.OctraCircle.request()`).

3. **`VeilLMClient.query()` in `inference.ts`** — replace the pattern-matching mock with a real Circle RPC call that routes the prompt through VeilLM distributed inference.

4. **`OctraClient.sendTransaction()` in `client.ts`** — add Ed25519 (NaCl) signing alongside the current ML-DSA-65 PQC layer so transactions are accepted by vanilla Octra testnet nodes.

---

## Octra Circle reference

Circle programs are written in AppliedML (.aml) or Rust (compiled to WASM). A minimal AML counter:

```
contract CircleCounter {
  state { counter: int }
  constructor() { self.counter = 0 }
  public view fn get_counter(): int { return self.counter }
  public fn inc(): int {
    self.counter += 1
    return self.counter
  }
}
```

Deployed via `circle.json` with `privacy_class: "sealed"`. Once deployed, programs are interacted with via `window.OctraCircle.request('program.call', { method, params, amount, ou })` inside the Circle's browser environment.

See [octra-labs/circle_examples](https://github.com/octra-labs/circle_examples) for working examples.

---

## Advanced API

### Circles core

**`Circle`** — low-level handle to a deployed Octra Circle. Holds the circle address, name, deploy tx hash, and local state snapshot. Used directly when you need `execute()` / `view()` / `getState()` without the agent spending-limit layer.

**`deployCircle(config)`** → `Promise<Circle>` — deploys a new Circle program. Mocked until Octra ships a Node.js deploy path; the interface is stable so downstream code compiles and tests today.

**`getCircle(client, address)`** → `Promise<Circle>` — retrieves an existing Circle handle by on-chain address.

**`OctraConnectionError`** — thrown by `OctraClient` methods when the Octra REST endpoint is unreachable.

### Agent

**`AgentCircle`** — Circle subclass that enforces `SpendingLimits` before submitting any execution. Returned by `createAgentCircle()`.

**`SpendingLimitError`** — thrown when a transaction would exceed the per-tx, per-day, or total spending cap configured on the `AgentCircle`.

**`ProtocolNotAllowedError`** — thrown when an instruction references a DeFi protocol not in the agent's `allowedProtocols` list.

### Inference

**`VeilLMClient`** — parses natural language DeFi intents into `ExecutionPlan` objects via pattern matching (mocked; will be replaced by real Circle inference when the VeilLM network goes live).

### CircleSession — private FHE inference lifecycle

**`CircleSession`** — manages the full lifecycle of a sealed GhostCircle used for private FHE inference: deploy → encrypt query → `private_predict` → decrypt result → teardown. Setting `config.reuse: true` keeps the Circle alive across multiple calls.

```typescript
const session = new CircleSession({ keypair, name: 'my-session' })
await session.create()
const encrypted = await session.encryptQuery('swap 1 ETH for USDC', context)
const resultBytes = await session.private_predict(encrypted)
const result = await session.decryptResult(resultBytes)
await session.teardown()
```

**`CircleSessionError`** — thrown on session lifecycle violations (e.g., calling `private_predict` before `create()`).

### FHE primitives

These map to Octra's HFHE (homomorphic FHE) instruction set used inside sealed Circles. The implementations are mock-compatible (CKKS-mock with XOR keystream); the calling convention matches the real Octra AML primitives so switching to the live SDK is a drop-in replacement.

| Export | Description |
|---|---|
| `FHEError` | Thrown on FHE operation failures (scale mismatch, empty key, truncated ciphertext). |
| `fhe_load_pk(pkBytes)` | Loads an FHE public key for CKKS-mock encryption; returns `FHEPublicKey`. |
| `fhe_scale(value, scale)` | Scales a plaintext float for CKKS FHE encoding; returns `FHEScaled`. |
| `fhe_add(a, b)` | Homomorphically adds two `FHEScaled` values; both must share the same scale. |
| `encryptPayload(payload, pk)` | Encrypts a `Uint8Array` payload for sealed Circle execution using `fhe_scale` / `fhe_add` feature encoding. |
| `decryptPayload(ciphertext, pk)` | Decrypts ciphertext produced by `encryptPayload` using the same public key. |

### Octra RPC layer

Direct access to the JSON-RPC 2.0 transport. Auto-probes the primary node (`GHOST_RPC_PRIMARY`) then the fallback (`GHOST_RPC_FALLBACK`) on first use; drops to mock mode if both are unreachable.

| Export | Description |
|---|---|
| `rpc(method, params)` | Raw JSON-RPC 2.0 call to the active Octra node; returns `null` in mock mode. |
| `probeNode()` | Probes primary + fallback endpoints and caches the result; idempotent. Returns `'real' \| 'mock'`. |
| `getRpcMode()` | Returns the cached RPC mode (`'real' \| 'mock'`) without issuing a network request. |
| `getActiveEndpoint()` | Returns the endpoint that responded, or the primary URL in mock mode. |
| `ghostNodeStatus()` | Fetches node status and the set of available RPC methods; returns `null` in mock mode. |
| `ghostNonce(address)` | Returns the on-chain account nonce for a deployer address (`0` in mock mode). |
| `ghostBalance(address)` | Returns the OCT balance in μOCT (1 OCT = 1 000 000 μOCT; `0n` in mock mode). |
| `ghostSubmitTx(txJson)` | Submits a signed transaction via `octra_submit`; returns the tx hash. |
| `ghostPollTx(hash)` | Polls `octra_transaction(hash)` for status; returns `null` if not found or in mock mode. |
| `ghostCompile(source)` | Compiles AppliedML source to base64 bytecode via the Octra compile RPC. |
| `ghostDeployCircle(address, nonce, payload?)` | Submits a `deploy_circle` transaction and returns `{ circleId, txHash }`. |
| `ghostFheKeygen()` | Generates an FHE keypair on-chain (RPC method name unconfirmed; returns `null` in mock mode). |
| `ghostFheEncrypt(dataB64, keyId)` | Encrypts data with the on-chain FHE key (RPC method name unconfirmed). |
| `ghostFheDecrypt(ciphertextB64, keyId)` | Decrypts an FHE ciphertext inside the sealed Circle (RPC method name unconfirmed). |
| `deriveGhostCircleId(payload, address, nonce)` | Deterministically derives a `"oct…"` circle_id per Octra's tagged-SHA-256 spec. |
| `GhostRpcError` | Thrown on Octra RPC failures; exposes `.method` and `.code`. |
| `GHOST_RPC_PRIMARY` | Primary Octra RPC endpoint (`https://octra.network/rpc`). |
| `GHOST_RPC_FALLBACK` | Fallback Octra RPC endpoint (`https://rpc.octra.org`). |
| `GHOST_CIRCLE_DEPLOY_PAYLOAD` | Canonical sealed Circle deploy payload template (runtime, privacy_class, limits). |

### Ghost AI inference program

The AppliedML program that runs as Ghost's on-chain inference kernel inside a sealed Circle.

| Export | Description |
|---|---|
| `GHOST_PROGRAM_SOURCE` | AppliedML source string for the `GhostInference` contract (`ghost_predict`, `ghost_predict_multi`, weight management). |
| `ghostCompileProgram(source?)` | Compiles the Ghost AML program via the Octra compile RPC; falls back to a base64 stub in mock mode. |
| `ghostDeployProgram(keypair, program, ou?)` | Deploys a compiled `GhostProgram` into a sealed Circle; returns `GhostCircleDeployment`. |
| `ghostCompileAndDeploy(keypair, source?, ou?)` | Convenience wrapper: compile + deploy in one call. |
