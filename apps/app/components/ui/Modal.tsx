'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import styles from './Modal.module.css';

interface ModalProps {
  readonly titleId: string;
  readonly onDismiss?: (() => void) | undefined;
  readonly children: ReactNode;
}

/** A minimal, dependency-free modal. Dismissal is opt-in per dialog — security/money dialogs should not pass `onDismiss`. */
export function Modal({ titleId, onDismiss, children }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    if (!onDismiss) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onDismiss]);

  return (
    <div
      className={styles.backdrop}
      onClick={onDismiss ? () => onDismiss() : undefined}
      data-testid="modal-backdrop"
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
