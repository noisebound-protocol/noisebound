# @noisebound/sigma-execute

σ-1 execution orchestrator. It takes a proposed `ActionRequest` and routes it
through three stages: `@noisebound/sigma-core`'s escalation policy, human
confirmation, and real execution (on-chain signing via `ethers`, or a
cloud-request authorization via `@noisebound/cloud-request`).

`evaluateAction` runs a request through the escalation policy: on-chain money
actions always map to sigma-core's `money` category, which unconditionally
denies (this package does not itself decide what to allow — it defers to
sigma-core and currently that policy hard-denies all money actions).
Non-money actions (e.g. cloud inference) come back `awaiting-confirmation`
with human-readable confirmation text built by `buildConfirmationSummary`.
Only after a human has approved that exact payload does `executeConfirmedAction`
run: it re-verifies the session capability against the current identity key
and revocation registry (failing closed if it has since expired or been
revoked, even if it was valid when confirmation was shown), then executes —
signing and broadcasting a native-token transfer for on-chain money actions,
or authorizing a TEE-attested request against a blind-pay token for cloud
inference actions.

## Exports

### Types

- `ActionRequest` — discriminated union of `OnChainMoneyActionRequest | CloudInferenceActionRequest`, everything this package knows how to execute.
- `OnChainMoneyActionRequest` — an on-chain native-token transfer request (`amountCents`, `currency`, `amountWei`, `recipient`, `asset`). Always maps to sigma-core's `money` escalation category, which unconditionally denies.
- `CloudInferenceActionRequest` — a private cloud inference call authorized via TEE attestation (`attestationToken`, `expectedMeasurements`, `verifyOptions`) plus a blind-pay `blindPayToken`.
- `ExecutionOutcome` — union of `DeniedOutcome | AwaitingConfirmationOutcome | ExecutedOutcome | ExecutionFailedOutcome`, the result of `evaluateAction` or `executeConfirmedAction`.
- `DeniedOutcome` — `{ status: 'denied', requestId, reason, timestamp }`, returned when the escalation policy hard-denies a request.
- `AwaitingConfirmationOutcome` — `{ status: 'awaiting-confirmation', requestId, confirmation, timestamp }`, returned when a request needs a human to confirm before execution.
- `ConfirmationPayload` — `{ requestId, summary }`, the exact text a UI should render to disclose/confirm an action to a human.
- `ExecutedOutcome` — `{ status: 'executed', requestId, result, timestamp }`, returned after successful execution.
- `ExecutionFailedOutcome` — `{ status: 'execution-failed', requestId, reason, cause?, timestamp }`, returned when execution was attempted but failed (capability invalid, spend limit exceeded, attestation/authorization failure, on-chain error, etc.); `cause` carries the underlying `CloudRequestOutcome` when available.
- `ExecutionResult` — union of `OnChainExecutionResult | CloudExecutionResult`, the payload inside an `ExecutedOutcome`.
- `OnChainExecutionResult` — `{ kind: 'on-chain-money', txHash }`.
- `CloudExecutionResult` — `{ kind: 'cloud-inference', outcome }`, where `outcome` is the authorized `CloudRequestOutcome`.
- `ExecutionRegistry` — dependencies `executeConfirmedAction` needs: `identityPublicKey`, `revocationRegistry`, `onChain` (an `OnChainExecutor`), `issuerPublicKey`, `redemptionRegistry`.
- `OnChainExecutor` — `{ send(request, sessionCapability): Promise<0x-hash> }`, signs and broadcasts a confirmed on-chain money action.
- `SessionKeyResolver` — `(sessionAddress) => SessionKey | undefined`, resolves the ephemeral secp256k1 session key backing a capability's session address, used by `createEthersOnChainExecutor`.

### Functions

- `evaluateAction(request: ActionRequest, clock: Clock): ExecutionOutcome` — runs a request through sigma-core's escalation policy; returns `denied` or `awaiting-confirmation` (never executes).
- `executeConfirmedAction(request, sessionCapability, registry: ExecutionRegistry, clock): Promise<ExecutionOutcome>` — re-validates the session capability at execution time (failing closed if expired/revoked), then executes the request; returns `executed` or `execution-failed`.
- `buildConfirmationSummary(request: ActionRequest): string` — builds the human-readable confirmation text for a request (e.g. `"Send $12.34 (USDC) to 0x1234...abc"` or `"Run cloud inference request \"...\""`).
- `createEthersOnChainExecutor(resolveSessionKey: SessionKeyResolver): OnChainExecutor` — builds an `OnChainExecutor` that signs (locally, via `ethers.Wallet`, never touching the network) and broadcasts a real native-token transfer on the currently active network (`@noisebound/networks`). Validates balance against amount + estimated gas before broadcasting.

### Errors (thrown by `createEthersOnChainExecutor`'s executor)

- `SessionKeyNotFoundError` — no session key is registered for the capability's session address, or the resolved key's address doesn't match.
- `SessionSigningError` — signing the transaction with the session key failed.
- `InsufficientBalanceError` — the session key's balance can't cover the transfer amount plus estimated gas (checked locally, and also raised if the RPC rejects the broadcast for insufficient funds).
- `OnChainBroadcastError` — reading account state from, or broadcasting to, the active network's RPC failed for any other reason.

## Usage

```ts
import { evaluateAction, executeConfirmedAction } from '@noisebound/sigma-execute';
import type { ExecutionRegistry, CloudInferenceActionRequest } from '@noisebound/sigma-execute';

const request: CloudInferenceActionRequest = {
  kind: 'cloud-inference',
  id: 'req-1',
  description: 'Summarize quarterly earnings call transcript',
  requiresDisclosure: true,
  attestationToken,
  expectedMeasurements,
  verifyOptions,
  blindPayToken,
};

// 1. Evaluate against escalation policy.
const evaluation = evaluateAction(request, clock);

if (evaluation.status === 'awaiting-confirmation') {
  // 2. Show evaluation.confirmation.summary to a human and get approval.

  // 3. Only after approval, execute.
  const outcome = await executeConfirmedAction(request, sessionCapability, registry, clock);
  // outcome.status is 'executed' or 'execution-failed'
}
```
