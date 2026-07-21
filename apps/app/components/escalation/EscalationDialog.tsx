'use client';

import { useState } from 'react';
import { evaluateEscalation } from '@noisebound/sigma-core';
import type { EscalationRequest } from '@noisebound/sigma-core';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import type { EscalationDataDisclosureItem, EscalationLogEntry } from '../../lib/types';
import { formatExpectedAmount } from '../../lib/format';
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
  const [armed, setArmed] = useState(false);
  const [typedAmount, setTypedAmount] = useState('');

  if (decision === 'require-secondary-confirmation' && request.category === 'money') {
    const confirmLabel = actionText ?? request.description;
    const expectedAmount = formatExpectedAmount(request.amountCents);
    const amountMatches = typedAmount.trim() === expectedAmount;

    return (
      <Modal titleId={titleId}>
        <header className={styles.header}>
          <h2 id={titleId} className={styles.titleWarning}>
            Extra confirmation required
          </h2>
          <PrivateZoneIndicator active={false} />
        </header>
        <div className={styles.secondaryBanner}>
          <span className={styles.secondaryIcon} aria-hidden="true">
            ⚠
          </span>
          <div>
            <p className={styles.secondaryTitle}>This exceeds your spend-limit threshold</p>
            <p className={styles.secondaryBody}>{request.description}</p>
          </div>
        </div>
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
        {!armed ? (
          <div className={styles.actions}>
            <Button variant="warning" fullWidth onClick={() => setArmed(true)}>
              {confirmLabel}
            </Button>
            <Button variant="secondary" fullWidth onClick={onStayPrivate}>
              Stay private, reduced capability
            </Button>
          </div>
        ) : (
          <div className={styles.actions}>
            <label htmlFor="secondary-confirm-amount" className={styles.typedAmountLabel}>
              Type {expectedAmount} to confirm
            </label>
            <input
              id="secondary-confirm-amount"
              className={styles.typedAmountInput}
              value={typedAmount}
              onChange={(event) => setTypedAmount(event.target.value)}
              inputMode="decimal"
              autoFocus
              autoComplete="off"
            />
            <Button variant="warning" fullWidth disabled={!amountMatches} onClick={onConfirm}>
              {confirmLabel}
            </Button>
            <Button variant="secondary" fullWidth onClick={onStayPrivate}>
              Stay private, reduced capability
            </Button>
          </div>
        )}
        <EscalationLog entries={log} />
      </Modal>
    );
  }

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
