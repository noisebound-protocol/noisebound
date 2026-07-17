'use client';

import { evaluateEscalation } from '@noisebound/sigma-core';
import type { EscalationRequest } from '@noisebound/sigma-core';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import type { EscalationDataDisclosureItem, EscalationLogEntry } from '../../lib/types';
import { EscalationLog } from './EscalationLog';
import { PrivateZoneIndicator } from './PrivateZoneIndicator';
import styles from './EscalationDialog.module.css';

export interface EscalationDialogProps {
  readonly request: EscalationRequest;
  readonly dataDisclosure: readonly EscalationDataDisclosureItem[];
  /** Required to render a confirm button — must name the real action (e.g. "Send $340 to 0x4f2...9a1"). */
  readonly actionText?: string | undefined;
  readonly log: readonly EscalationLogEntry[];
  readonly onConfirm: () => void;
  readonly onStayPrivate: () => void;
  readonly onAcknowledgeBlocked: () => void;
}

export function EscalationDialog({
  request,
  dataDisclosure,
  actionText,
  log,
  onConfirm,
  onStayPrivate,
  onAcknowledgeBlocked,
}: EscalationDialogProps) {
  const decision = evaluateEscalation(request);
  const titleId = 'escalation-dialog-title';

  if (decision === 'deny') {
    return (
      <Modal titleId={titleId}>
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            Escalation blocked
          </h2>
          <PrivateZoneIndicator active />
        </header>
        <div className={styles.blockedBanner}>
          <p className={styles.blockedTitle}>This action never leaves the private zone</p>
          <p className={styles.blockedBody}>{request.description}</p>
        </div>
        <p className={styles.summary}>
          Requests that touch real money are always denied at this layer. To let σ-1 act, increase
          a session key&rsquo;s spend scope instead — see Session keys.
        </p>
        <div className={styles.actions}>
          <Button variant="secondary" fullWidth onClick={onAcknowledgeBlocked}>
            Got it
          </Button>
        </div>
        <EscalationLog entries={log} />
      </Modal>
    );
  }

  const confirmLabel = actionText ?? request.description;

  return (
    <Modal titleId={titleId}>
      <header className={styles.header}>
        <h2 id={titleId} className={styles.title}>
          Leave the private zone?
        </h2>
        <PrivateZoneIndicator active={false} />
      </header>
      <p className={styles.summary}>{request.description}</p>
      <ul className={styles.disclosureList}>
        {dataDisclosure.map((item) => (
          <li className={styles.disclosureRow} key={item.label}>
            <span className={styles.disclosureLabel}>{item.label}</span>
            <span className={styles.disclosureValue} data-mono>
              {item.value}
            </span>
          </li>
        ))}
      </ul>
      <div className={styles.actions}>
        <Button variant="primary" fullWidth onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button variant="secondary" fullWidth onClick={onStayPrivate}>
          Stay private, reduced capability
        </Button>
      </div>
      <EscalationLog entries={log} />
    </Modal>
  );
}
