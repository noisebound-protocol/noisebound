import { SystemClock } from '@noisebound/sigma-core';
import { evaluateAction } from '@noisebound/sigma-execute';
import type { ActionRequest, ExecutionOutcome } from '@noisebound/sigma-execute';

const clock = new SystemClock();

/** Runs a proposed action through sigma-execute's evaluateAction with a real system clock. */
export function evaluateActionRequest(request: ActionRequest): ExecutionOutcome {
  return evaluateAction(request, clock);
}
