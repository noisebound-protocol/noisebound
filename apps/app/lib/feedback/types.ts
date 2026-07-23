export type FeedbackCategory = 'bug' | 'feature' | 'other';

export interface FeedbackEntry {
  readonly id: string;
  readonly submittedAt: number;
  readonly message: string;
  readonly category: FeedbackCategory | null;
}
