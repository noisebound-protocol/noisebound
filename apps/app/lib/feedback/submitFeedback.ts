import { randomUUID } from 'node:crypto';
import { createFeedbackStore } from './feedbackStore';
import type { FeedbackCategory, FeedbackEntry } from './types';

const MAX_MESSAGE_LENGTH = 4000;

export interface SubmitFeedbackInput {
  readonly message: string;
  readonly category: FeedbackCategory | null;
}

export function submitFeedback(input: SubmitFeedbackInput): FeedbackEntry {
  const message = input.message.trim();
  if (message.length === 0) {
    throw new Error('Feedback message cannot be empty.');
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Feedback message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`);
  }

  const entry: FeedbackEntry = {
    id: randomUUID(),
    submittedAt: Date.now(),
    message,
    category: input.category,
  };

  createFeedbackStore().append(entry);
  return entry;
}
