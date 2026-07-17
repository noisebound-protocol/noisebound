'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import type { SerializedIdentityKeyPair } from '@noisebound/identity';
import { issueSessionKeyAction } from '../../app/actions/sessionKeys';
import { parseEthToWei } from '../../lib/format';
import type { StoredSessionCapability } from '../../lib/types';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import styles from './IssueSessionKeyForm.module.css';

const DURATION_OPTIONS = [
  { label: '1 hour', ttlMs: 60 * 60 * 1000 },
  { label: '24 hours', ttlMs: 24 * 60 * 60 * 1000 },
  { label: '7 days', ttlMs: 7 * 24 * 60 * 60 * 1000 },
] as const;

interface IssueSessionKeyFormProps {
  readonly identity: SerializedIdentityKeyPair;
  readonly onIssued: (capability: StoredSessionCapability) => void;
}

export function IssueSessionKeyForm({ identity, onIssued }: IssueSessionKeyFormProps) {
  const [label, setLabel] = useState('Trading session key');
  const [maxSpendEth, setMaxSpendEth] = useState('0.01');
  const [ttlMs, setTtlMs] = useState<number>(DURATION_OPTIONS[1].ttlMs);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    let maxSpendWei: bigint;
    try {
      maxSpendWei = parseEthToWei(maxSpendEth);
    } catch {
      setError('Enter a valid decimal ETH amount for the spend scope.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await issueSessionKeyAction(
        identity,
        { maxSpendWei: maxSpendWei.toString() },
        ttlMs,
      );

      onIssued({
        payload: result.capability.payload,
        signature: result.capability.signature,
        label: label.trim() || 'Session key',
        fundingTxHash: result.fundingTxHash,
        revoked: false,
      });
      setSuccess(`Issued and funded — funding tx ${result.fundingTxHash.slice(0, 10)}…`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to issue session key.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Panel>
      <form className={styles.form} onSubmit={(event) => void handleSubmit(event)}>
        <div className={styles.row}>
          <label className={styles.label} htmlFor="session-label">
            Label
          </label>
          <input
            id="session-label"
            className={styles.input}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </div>

        <div className={styles.row}>
          <label className={styles.label} htmlFor="session-max-spend">
            Max spend scope (ETH)
          </label>
          <input
            id="session-max-spend"
            className={styles.input}
            value={maxSpendEth}
            onChange={(event) => setMaxSpendEth(event.target.value)}
            inputMode="decimal"
          />
        </div>

        <div className={styles.row}>
          <label className={styles.label} htmlFor="session-duration">
            Duration
          </label>
          <select
            id="session-duration"
            className={styles.select}
            value={ttlMs}
            onChange={(event) => setTtlMs(Number(event.target.value))}
          >
            {DURATION_OPTIONS.map((option) => (
              <option key={option.label} value={option.ttlMs}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {error ? <p className={styles.error}>{error}</p> : null}
        {success ? <p className={styles.success}>{success}</p> : null}

        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? 'Issuing…' : 'Issue session key'}
        </Button>
      </form>
    </Panel>
  );
}
