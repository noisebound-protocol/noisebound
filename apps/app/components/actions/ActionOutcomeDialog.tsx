'use client';

import type { ActionRequest, ExecutionOutcome } from '@noisebound/sigma-execute';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { EscalationLog } from '../escalation/EscalationLog';
import { PrivateZoneIndicator } from '../escalation/PrivateZoneIndicator';
import type { EscalationLogEntry } from '../../lib/types';
import { truncateAddress } from '../../lib/format';
import styles from '../escalation/EscalationDialog.module.css';

export interface ActionOutcomeDialogProps {
  readonly request: ActionRequest;
  readonly outcome: ExecutionOutcome;
  readonly log: readonly EscalationLogEntry[];
  readonly onConfirm: () => void;
  readonly onDismiss: () => void;
}

export function ActionOutcomeDialog({
  request,
  outcome,
  log,
  onConfirm,
  onDismiss,
}: ActionOutcomeDialogProps) {
  const titleId = 'action-outcome-dialog-title';

  if (outcome.status === 'denied') {
    return (
      <Modal titleId={titleId}>
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            Action denied
          </h2>
          <PrivateZoneIndicator active />
        </header>
        <div className={styles.blockedBanner}>
          <p className={styles.blockedTitle}>This action never leaves the private zone</p>
          <p className={styles.blockedBody}>{outcome.reason}</p>
        </div>
        <p className={styles.summary}>{request.description}</p>
        <div className={styles.actions}>
          <Button variant="secondary" fullWidth onClick={onDismiss}>
            Got it
          </Button>
        </div>
        <EscalationLog entries={log} />
      </Modal>
    );
  }

  if (outcome.status === 'awaiting-confirmation') {
    return (
      <Modal titleId={titleId}>
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            Leave the private zone?
          </h2>
          <PrivateZoneIndicator active={false} />
        </header>
        <p className={styles.summary}>{outcome.confirmation.summary}</p>
        <div className={styles.actions}>
          <Button variant="primary" fullWidth onClick={onConfirm}>
            {outcome.confirmation.summary}
          </Button>
          <Button variant="secondary" fullWidth onClick={onDismiss}>
            Stay private, reduced capability
          </Button>
        </div>
        <EscalationLog entries={log} />
      </Modal>
    );
  }

  if (outcome.status === 'executed') {
    const txHash = outcome.result.kind === 'on-chain-money' ? outcome.result.txHash : undefined;
    return (
      <Modal titleId={titleId}>
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            Action executed
          </h2>
          <PrivateZoneIndicator active={false} />
        </header>
        <p className={styles.summary}>
          {txHash ? `Sent — tx ${truncateAddress(txHash)}` : 'Action completed.'}
        </p>
        <div className={styles.actions}>
          <Button variant="primary" fullWidth onClick={onDismiss}>
            Done
          </Button>
        </div>
        <EscalationLog entries={log} />
      </Modal>
    );
  }

  return (
    <Modal titleId={titleId}>
      <header className={styles.header}>
        <h2 id={titleId} className={styles.title}>
          Execution failed
        </h2>
        <PrivateZoneIndicator active={false} />
      </header>
      <div className={styles.blockedBanner}>
        <p className={styles.blockedTitle}>The action could not be executed</p>
        <p className={styles.blockedBody}>{outcome.reason}</p>
      </div>
      <div className={styles.actions}>
        <Button variant="secondary" fullWidth onClick={onDismiss}>
          Close
        </Button>
      </div>
      <EscalationLog entries={log} />
    </Modal>
  );
}
