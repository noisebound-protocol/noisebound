import { verifySessionCapability } from '@noisebound/pqc-wallet';
import type { SessionCapability } from '@noisebound/pqc-wallet';
import { authorizeCloudRequest } from '@noisebound/cloud-request';
import type { Clock } from '@noisebound/sigma-core';
import type {
  ActionRequest,
  CloudInferenceActionRequest,
  ExecutionOutcome,
  ExecutionRegistry,
  OnChainMoneyActionRequest,
} from './types.js';

function failed(requestId: string, reason: string, clock: Clock): ExecutionOutcome {
  return { status: 'execution-failed', requestId, reason, timestamp: clock.now() };
}

async function executeOnChainMoney(
  request: OnChainMoneyActionRequest,
  sessionCapability: SessionCapability,
  registry: ExecutionRegistry,
  clock: Clock,
): Promise<ExecutionOutcome> {
  const { scope } = sessionCapability.payload;
  const maxSpendWei = BigInt(scope.maxSpendWei);

  if (request.amountWei > maxSpendWei) {
    return failed(
      request.id,
      `Requested amount ${request.amountWei.toString()} wei exceeds the capability's max spend of ${scope.maxSpendWei} wei`,
      clock,
    );
  }

  if (scope.allowedContracts !== undefined && !scope.allowedContracts.includes(request.recipient)) {
    return failed(
      request.id,
      `Recipient ${request.recipient} is not in the capability's allowed contracts`,
      clock,
    );
  }

  try {
    const txHash = await registry.onChain.send(request, sessionCapability);
    return {
      status: 'executed',
      requestId: request.id,
      result: { kind: 'on-chain-money', txHash },
      timestamp: clock.now(),
    };
  } catch (error) {
    return failed(request.id, error instanceof Error ? error.message : String(error), clock);
  }
}

async function executeCloudInference(
  request: CloudInferenceActionRequest,
  registry: ExecutionRegistry,
  clock: Clock,
): Promise<ExecutionOutcome> {
  const outcome = await authorizeCloudRequest(
    request.attestationToken,
    request.expectedMeasurements,
    request.verifyOptions,
    request.blindPayToken,
    registry.issuerPublicKey,
    registry.redemptionRegistry,
  );

  if (outcome.status !== 'authorized') {
    return {
      status: 'execution-failed',
      requestId: request.id,
      reason: `Cloud request authorization failed: ${outcome.status}`,
      cause: outcome,
      timestamp: clock.now(),
    };
  }

  return {
    status: 'executed',
    requestId: request.id,
    result: { kind: 'cloud-inference', outcome },
    timestamp: clock.now(),
  };
}

/**
 * Executes an action a human has already confirmed. Re-validates the
 * session capability against the registry's identity key and revocation
 * list at THIS moment — time may have passed since evaluateAction ran, so a
 * capability that was valid at confirmation time can be expired or revoked
 * by now, and this fails closed rather than trusting the stale confirmation.
 */
export async function executeConfirmedAction(
  request: ActionRequest,
  sessionCapability: SessionCapability,
  registry: ExecutionRegistry,
  clock: Clock,
): Promise<ExecutionOutcome> {
  const capabilityValid = verifySessionCapability(
    registry.identityPublicKey,
    sessionCapability,
    registry.revocationRegistry,
  );

  if (!capabilityValid) {
    return failed(
      request.id,
      'Session capability is expired, revoked, or invalid at execution time',
      clock,
    );
  }

  switch (request.kind) {
    case 'on-chain-money':
      return executeOnChainMoney(request, sessionCapability, registry, clock);
    case 'cloud-inference':
      return executeCloudInference(request, registry, clock);
  }
}
