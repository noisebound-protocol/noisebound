import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SubmitFeedbackInput } from '../../../app/actions/feedback';
import type { FeedbackEntry } from '../../../lib/feedback/types';

const RECORDED_ENTRY: FeedbackEntry = {
  id: 'entry-1',
  submittedAt: 1_700_000_000_000,
  message: 'Loving the escalation dialog.',
  category: 'other',
};

const submitFeedback = vi.fn(async (_input: SubmitFeedbackInput) => RECORDED_ENTRY);

vi.mock('../../../app/actions/feedback', () => ({
  submitFeedback: (input: SubmitFeedbackInput) => submitFeedback(input),
}));

const { FeedbackForm } = await import('../FeedbackForm');

describe('FeedbackForm', () => {
  it('rejects an empty submission without calling submitFeedback', async () => {
    const user = userEvent.setup();
    render(<FeedbackForm />);

    await user.click(screen.getByRole('button', { name: 'Submit feedback' }));

    expect(await screen.findByText('Enter some feedback before submitting.')).toBeInTheDocument();
    expect(submitFeedback).not.toHaveBeenCalled();
  });

  it('submits trimmed feedback with the selected category and shows a confirmation', async () => {
    const user = userEvent.setup();
    render(<FeedbackForm />);

    await user.type(screen.getByLabelText('Feedback'), '  Loving the escalation dialog.  ');
    await user.selectOptions(screen.getByLabelText('Category (optional)'), 'other');
    await user.click(screen.getByRole('button', { name: 'Submit feedback' }));

    await screen.findByText('Thanks — your feedback was recorded.');
    expect(submitFeedback).toHaveBeenCalledOnce();
    expect(submitFeedback).toHaveBeenCalledWith({
      message: 'Loving the escalation dialog.',
      category: 'other',
    });
  });

  it('submits with no category selected as null', async () => {
    const user = userEvent.setup();
    render(<FeedbackForm />);

    await user.type(screen.getByLabelText('Feedback'), 'A bug in the sessions page.');
    await user.click(screen.getByRole('button', { name: 'Submit feedback' }));

    await screen.findByText('Thanks — your feedback was recorded.');
    expect(submitFeedback).toHaveBeenCalledWith({
      message: 'A bug in the sessions page.',
      category: null,
    });
  });

  it('shows an error message and does not clear the form when submission fails', async () => {
    submitFeedback.mockRejectedValueOnce(new Error('Feedback message must be 4000 characters or fewer.'));
    const user = userEvent.setup();
    render(<FeedbackForm />);

    await user.type(screen.getByLabelText('Feedback'), 'Some feedback');
    await user.click(screen.getByRole('button', { name: 'Submit feedback' }));

    expect(await screen.findByText('Feedback message must be 4000 characters or fewer.')).toBeInTheDocument();
    expect(screen.getByLabelText('Feedback')).toHaveValue('Some feedback');
  });
});
