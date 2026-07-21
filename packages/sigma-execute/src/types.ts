import type { RevocationRegistry, SessionCapability } from '@noisebound/pqc-wallet';
import type {
  AttestationToken,
  MeasurementAllowlist,
  VerifyAttestationTokenOptions,
} from '@noisebound/attest';
import type { RedemptionRegistry, Token } from '@noisebound/blind-pay';
import type { CloudRequestOutcome } from '@noisebound/cloud-request';
import type { webcrypto } from 'node:crypto';

interface BaseActionRequest {
  readonly id: string;
  readonly description: string;
}

/**
 * An on-chain transfer of value. Always maps to sigma-core's 'money'
 * escalation category, which never auto-executes — see evaluateAction. It
 * comes back as 'require-confirmation' by default, or
 * 'require-secondary-confirmation' once amountWei exceeds the configured
 * spend threshold.
 */
export interface OnChainMoneyActionRequest extends BaseActionRequest {
  readonly kind: 'on-chain-money';
  readonly amountCents: number;
  readonly currency: string;
  readonly amountWei: bigint;
  readonly recipient: `0x${string}`;
  readonly asset: string;
}

/** A private cloud inference call, authorized via TEE attestation + blind-pay. */
export interface CloudInferenceActionRequest extends BaseActionRequest {
  readonly kind: 'cloud-inference';
  readonly requiresDisclosure: boolean;
  readonly attestationToken: AttestationToken;
  readonly expectedMeasurements: MeasurementAllowlist;
  readonly verifyOptions: VerifyAttestationTokenOptions;
  readonly blindPayToken: Token;
}

/**
 * Discriminated union of everything sigma-execute knows how to run.
 * Add new members here (and a matching branch in evaluateAction /
 * executeConfirmedAction) to support new action kinds.
 */
export type ActionRequest = OnChainMoneyActionRequest | CloudInferenceActionRequest;

/**
 * The shape a model/agent actually produces for an on-chain money request:
 * `amount` is a decimal ETH string (e.g. "0.001"), never wei — an LLM
 * cannot reliably do exact 10^18 big-integer arithmetic (see
 * packages/model-eval), so wei conversion must never be model output. This
 * is not a trusted {@link OnChainMoneyActionRequest}; it must be converted
 * via `fromAgentMoneyAction` before evaluation or execution logic sees it.
 */
export interface AgentMoneyActionRequest {
  readonly kind: 'on-chain-money';
  readonly id: string;
  readonly description: string;
  readonly recipient: `0x${string}`;
  readonly amount: string;
  readonly asset: string;
}

export interface DeniedOutcome {
  readonly status: 'denied';
  readonly requestId: string;
  readonly reason: string;
  readonly timestamp: Date;
}

/** The exact payload a UI renders to disclose/confirm an action to a human. */
export interface ConfirmationPayload {
  readonly requestId: string;
  readonly summary: string;
}

export interface AwaitingConfirmationOutcome {
  readonly status: 'awaiting-confirmation';
  readonly requestId: string;
  readonly confirmation: ConfirmationPayload;
  readonly timestamp: Date;
}

/** A money action above the spend threshold — needs a second, explicit type-to-confirm step beyond {@link AwaitingConfirmationOutcome}. */
export interface RequiresSecondaryConfirmationOutcome {
  readonly status: 'requires-secondary-confirmation';
  readonly requestId: string;
  readonly confirmation: ConfirmationPayload;
  readonly timestamp: Date;
}

export interface OnChainExecutionResult {
  readonly kind: 'on-chain-money';
  readonly txHash: `0x${string}`;
}

export interface CloudExecutionResult {
  readonly kind: 'cloud-inference';
  readonly outcome: Extract<CloudRequestOutcome, { readonly status: 'authorized' }>;
}

export type ExecutionResult = OnChainExecutionResult | CloudExecutionResult;

export interface ExecutedOutcome {
  readonly status: 'executed';
  readonly requestId: string;
  readonly result: ExecutionResult;
  readonly timestamp: Date;
}

export interface ExecutionFailedOutcome {
  readonly status: 'execution-failed';
  readonly requestId: string;
  readonly reason: string;
  /** The underlying failure detail, when one is available (e.g. a cloud-request denial). */
  readonly cause?: CloudRequestOutcome;
  readonly timestamp: Date;
}

export type ExecutionOutcome =
  | DeniedOutcome
  | AwaitingConfirmationOutcome
  | RequiresSecondaryConfirmationOutcome
  | ExecutedOutcome
  | ExecutionFailedOutcome;

/** Signs and broadcasts a confirmed on-chain money action, returning the real tx hash. */
export interface OnChainExecutor {
  send(request: OnChainMoneyActionRequest, sessionCapability: SessionCapability): Promise<`0x${string}`>;
}

/**
 * Everything executeConfirmedAction needs to re-validate the session
 * capability and route each action kind to its real execution path.
 */
export interface ExecutionRegistry {
  readonly identityPublicKey: Uint8Array;
  readonly revocationRegistry: RevocationRegistry;
  readonly onChain: OnChainExecutor;
  readonly issuerPublicKey: webcrypto.CryptoKey;
  readonly redemptionRegistry: RedemptionRegistry;
}
