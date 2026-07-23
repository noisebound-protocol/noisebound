'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { submitFeedback } from '../../app/actions/feedback';
import type { FeedbackCategory } from '../../lib/feedback/types';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import styles from './FeedbackForm.module.css';

const CATEGORY_OPTIONS: ReadonlyArray<{ value: FeedbackCategory | ''; label: string }> = [
  { value: '', label: 'No category' },
  { value: 'bug', label: 'Bug' },
  { value: 'feature', label: 'Feature request' },
  { value: 'other', label: 'Other' },
];

export function FeedbackForm() {
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState<FeedbackCategory | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitted(false);

    const trimmed = message.trim();
    if (trimmed.length === 0) {
      setError('Enter some feedback before submitting.');
      return;
    }

    setSubmitting(true);
    try {
      await submitFeedback({ message: trimmed, category: category === '' ? null : category });
      setMessage('');
      setCategory('');
      setSubmitted(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to submit feedback.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1 className={styles.title}>Feedback</h1>
      <p className={styles.hint}>
        Tell us what&rsquo;s working, what&rsquo;s broken, or what you&rsquo;d like to see next.
      </p>
      <Panel>
        <form className={styles.form} onSubmit={(event) => void handleSubmit(event)}>
          <div className={styles.row}>
            <label className={styles.label} htmlFor="feedback-category">
              Category (optional)
            </label>
            <select
              id="feedback-category"
              className={styles.select}
              value={category}
              onChange={(event) => setCategory(event.target.value as FeedbackCategory | '')}
            >
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.row}>
            <label className={styles.label} htmlFor="feedback-message">
              Feedback
            </label>
            <textarea
              id="feedback-message"
              className={styles.textarea}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="What's working, what's broken, what would help?"
            />
          </div>

          {error ? <p className={styles.error}>{error}</p> : null}
          {submitted ? <p className={styles.success}>Thanks — your feedback was recorded.</p> : null}

          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit feedback'}
          </Button>
        </form>
      </Panel>
    </div>
  );
}
