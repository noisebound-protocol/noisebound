import { describe, expect, it } from 'vitest';
import { sendEmail, triggerActivationFollowUpEmail, triggerWelcomeEmail } from '../onboarding';
import { composeActivationFollowUpEmail, composeWelcomeEmail } from '../templates';

describe('sendEmail', () => {
  it('is a no-op stub that resolves without throwing (not yet wired to a real provider)', async () => {
    await expect(
      sendEmail({ to: 'user@example.com', from: 'founder@noisebound.com', subject: 'x', text: 'y' }),
    ).resolves.toBeUndefined();
  });
});

describe('triggerWelcomeEmail', () => {
  it('returns the same message composeWelcomeEmail would produce', async () => {
    const recipient = { email: 'user@example.com', name: 'Ada' };
    const message = await triggerWelcomeEmail(recipient);
    expect(message).toEqual(composeWelcomeEmail(recipient));
  });

  it('passes through a custom docs URL', async () => {
    const recipient = { email: 'user@example.com' };
    const message = await triggerWelcomeEmail(recipient, 'https://docs.example.com/x');
    expect(message.text).toContain('https://docs.example.com/x');
  });
});

describe('triggerActivationFollowUpEmail', () => {
  it('returns the same message composeActivationFollowUpEmail would produce', async () => {
    const recipient = { email: 'user@example.com', name: 'Ada' };
    const message = await triggerActivationFollowUpEmail(recipient);
    expect(message).toEqual(composeActivationFollowUpEmail(recipient));
  });
});
