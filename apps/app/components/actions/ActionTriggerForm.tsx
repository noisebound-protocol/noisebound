'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import type { ActionRequest, ExecutionOutcome } from '@noisebound/sigma-execute';
import { evaluateSendActionTrigger } from '../../app/actions/actionTrigger';
import { parseEthToWei } from '../../lib/format';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import styles from './ActionTriggerForm.module.css';

const RECIPIENT_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/** Only action kind this form can build today — see requirement to start with a single type. */
const ACTION_TYPE = 'send' as const;

export interface ActionTriggerResult {
  readonly request: ActionRequest;
  readonly outcome: ExecutionOutcome;
}

interface ActionTriggerFormProps {
  readonly onEvaluated: (result: ActionTriggerResult) => void;
}

let requestSequence = 0;

export function ActionTriggerForm({ onEvaluated }: ActionTriggerFormProps) {
  const [recipient, setRecipient] = useState('');
  const [amountEth, setAmountEth] = useState('0.01');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const trimmedRecipient = recipient.trim();
    if (!RECIPIENT_PATTERN.test(trimmedRecipient)) {
      setError('Enter a valid 0x-prefixed, 40-character recipient address.');
      return;
    }

    let amountWei: bigint;
    try {
      amountWei = parseEthToWei(amountEth);
    } catch {
      setError('Enter a valid decimal ETH amount.');
      return;
    }
    if (amountWei <= 0n) {
      setError('Amount must be greater than zero.');
      return;
    }

    requestSequence += 1;
    const request: ActionRequest = {
      kind: 'on-chain-money',
      id: `send-${Date.now()}-${requestSequence}`,
      description: `Send ${amountEth.trim()} ETH to ${trimmedRecipient}`,
      amountCents: Math.round(Number(amountEth) * 100),
      currency: 'ETH',
      amountWei,
      recipient: trimmedRecipient as `0x${string}`,
      asset: 'ETH',
    };

    setSubmitting(true);
    try {
      const outcome: ExecutionOutcome = await evaluateSendActionTrigger({
        id: request.id,
        description: request.description,
        amountCents: request.amountCents,
        currency: request.currency,
        amountWei: amountWei.toString(),
        recipient: request.recipient,
        asset: request.asset,
      });
      onEvaluated({ request, outcome });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to evaluate action.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Panel>
      <form className={styles.form} onSubmit={(event) => void handleSubmit(event)}>
        <div className={styles.row}>
          <label className={styles.label} htmlFor="action-type">
            Action type
          </label>
          <select id="action-type" className={styles.select} value={ACTION_TYPE} disabled>
            <option value={ACTION_TYPE}>Send</option>
          </select>
        </div>

        <div className={styles.row}>
          <label className={styles.label} htmlFor="action-recipient">
            Recipient address
          </label>
          <input
            id="action-recipient"
            className={styles.input}
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            placeholder="0x..."
            data-mono
          />
        </div>

        <div className={styles.row}>
          <label className={styles.label} htmlFor="action-amount">
            Amount (ETH)
          </label>
          <input
            id="action-amount"
            className={styles.input}
            value={amountEth}
            onChange={(event) => setAmountEth(event.target.value)}
            inputMode="decimal"
          />
        </div>

        {error ? <p className={styles.error}>{error}</p> : null}

        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? 'Evaluating…' : 'Evaluate action'}
        </Button>
      </form>
    </Panel>
  );
}
