import { describe, expect, it } from 'vitest';
import { composeActivationFollowUpEmail, composeWelcomeEmail, ONBOARDING_FROM_ADDRESS } from '../templates';

describe('composeWelcomeEmail', () => {
  it('sends from the founder address to the recipient', () => {
    const message = composeWelcomeEmail({ email: 'user@example.com' });
    expect(message.from).toBe(ONBOARDING_FROM_ADDRESS);
    expect(message.from).toBe('founder@noisebound.com');
    expect(message.to).toBe('user@example.com');
  });

  it('greets the recipient by name when one is provided', () => {
    const message = composeWelcomeEmail({ email: 'user@example.com', name: 'Ada' });
    expect(message.text).toContain('Hi Ada,');
  });

  it('falls back to a generic greeting when no name is provided', () => {
    const message = composeWelcomeEmail({ email: 'user@example.com' });
    expect(message.text).toContain('Hi,');
  });

  it('includes the docs link', () => {
    const message = composeWelcomeEmail({ email: 'user@example.com' }, 'https://docs.example.com/start');
    expect(message.text).toContain('https://docs.example.com/start');
  });

  it('uses the default docs URL when none is provided', () => {
    const message = composeWelcomeEmail({ email: 'user@example.com' });
    expect(message.text).toContain('https://docs.noisebound.com');
  });
});

describe('composeActivationFollowUpEmail', () => {
  it('sends from the founder address and references activation', () => {
    const message = composeActivationFollowUpEmail({ email: 'user@example.com', name: 'Ada' });
    expect(message.from).toBe(ONBOARDING_FROM_ADDRESS);
    expect(message.subject).toMatch(/getting started/i);
    expect(message.text).toContain('Hi Ada,');
  });

  it('includes the docs link', () => {
    const message = composeActivationFollowUpEmail({ email: 'user@example.com' }, 'https://docs.example.com/start');
    expect(message.text).toContain('https://docs.example.com/start');
  });

  it('has a distinct subject line from the welcome email', () => {
    const welcome = composeWelcomeEmail({ email: 'user@example.com' });
    const followUp = composeActivationFollowUpEmail({ email: 'user@example.com' });
    expect(followUp.subject).not.toBe(welcome.subject);
  });
});
