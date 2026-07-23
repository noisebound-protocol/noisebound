import { SystemClock } from '@noisebound/sigma-core';
import { evaluateAction } from '@noisebound/sigma-execute';
import type { ActionRequest, ExecutionOutcome, RecipientHistory } from '@noisebound/sigma-execute';
import { createPersistedRecipientHistory } from './recipientHistoryStore';

const clock = new SystemClock();
const recipientHistory = createPersistedRecipientHistory();

/**
 * Runs a proposed action through sigma-execute's evaluateAction with a real
 * system clock and the app's persisted recipient history, so first-time
 * recipients get novelty-gated in production. `history` defaults to the
 * process-wide persisted store; tests may override it to point at an
 * isolated location.
 */
export function evaluateActionRequest(request: ActionRequest, history: RecipientHistory = recipientHistory): ExecutionOutcome {
  return evaluateAction(request, clock, history);
}
