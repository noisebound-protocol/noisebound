'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { deserializeIdentityKeyPair, generateIdentityKeyPair, serializeIdentityKeyPair } from '@noisebound/identity';
import type { SerializedIdentityKeyPair } from '@noisebound/identity';
import { saveStoredIdentity } from '../../lib/identityStore';
import { Button } from '../ui/Button';
import styles from './GetStartedFlow.module.css';

type Mode = 'idle' | 'importing';

function isSerializedIdentityKeyPair(value: unknown): value is SerializedIdentityKeyPair {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate['publicKey'] === 'string' && typeof candidate['secretKey'] === 'string';
}

export function GetStartedFlow() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('idle');
  const [importValue, setImportValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleCreate() {
    const identity = serializeIdentityKeyPair(generateIdentityKeyPair());
    saveStoredIdentity(identity);
    router.push('/dashboard');
  }

  function handleImport() {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(importValue);
    } catch {
      setError('That doesn’t look like valid identity key JSON.');
      return;
    }

    if (!isSerializedIdentityKeyPair(parsed)) {
      setError('Expected an object with "publicKey" and "secretKey" base64 fields.');
      return;
    }

    try {
      deserializeIdentityKeyPair(parsed);
    } catch {
      setError('Those keys couldn’t be decoded. Check the base64 values.');
      return;
    }

    saveStoredIdentity(parsed);
    router.push('/dashboard');
  }

  return (
    <div className={styles.flow}>
      {mode === 'idle' ? (
        <div className={styles.primaryRow}>
          <Button variant="primary" fullWidth onClick={handleCreate}>
            Get started
          </Button>
          <Button variant="ghost" onClick={() => setMode('importing')}>
            Import identity
          </Button>
        </div>
      ) : (
        <div className={styles.importPanel}>
          <p className={styles.hint}>Paste a serialized identity keypair ({'{ publicKey, secretKey }'}).</p>
          <textarea
            className={styles.textarea}
            value={importValue}
            onChange={(event) => setImportValue(event.target.value)}
            placeholder='{"publicKey":"...","secretKey":"..."}'
            data-mono
          />
          {error ? <p className={styles.error}>{error}</p> : null}
          <div className={styles.importActions}>
            <Button variant="primary" onClick={handleImport}>
              Import
            </Button>
            <Button variant="ghost" onClick={() => setMode('idle')}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
