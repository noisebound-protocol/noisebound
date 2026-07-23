'use server';

import 'server-only';
import { submitFeedback as submitFeedbackImpl } from '../../lib/feedback/submitFeedback';
import type { SubmitFeedbackInput } from '../../lib/feedback/submitFeedback';
import type { FeedbackEntry } from '../../lib/feedback/types';

export type { SubmitFeedbackInput };

export async function submitFeedback(input: SubmitFeedbackInput): Promise<FeedbackEntry> {
  return submitFeedbackImpl(input);
}
