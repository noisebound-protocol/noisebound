import type { EmailMessage, EmailRecipient } from './types';

export const ONBOARDING_FROM_ADDRESS = 'founder@noisebound.com';

export const DEFAULT_DOCS_URL = 'https://docs.noisebound.com';

function greeting(recipient: EmailRecipient): string {
  return recipient.name ? `Hi ${recipient.name},` : 'Hi,';
}

/** Sent immediately after a beta user signs up. */
export function composeWelcomeEmail(recipient: EmailRecipient, docsUrl: string = DEFAULT_DOCS_URL): EmailMessage {
  return {
    to: recipient.email,
    from: ONBOARDING_FROM_ADDRESS,
    subject: 'Welcome to the Noisebound beta',
    text: [
      greeting(recipient),
      '',
      "You're in — welcome to the Noisebound beta.",
      '',
      `Noisebound is σ-1, an AI execution agent that acts, spends, and negotiates on your behalf, privately by default. Get started here: ${docsUrl}`,
      '',
      "We're a small team and we read every reply. If something feels off or you want to see something built, just hit reply — or use the in-app feedback form once you're set up.",
      '',
      '— The Noisebound team',
    ].join('\n'),
  };
}

/** Sent 3 days after signup to nudge beta users who haven't activated yet. */
export function composeActivationFollowUpEmail(
  recipient: EmailRecipient,
  docsUrl: string = DEFAULT_DOCS_URL,
): EmailMessage {
  return {
    to: recipient.email,
    from: ONBOARDING_FROM_ADDRESS,
    subject: 'Getting started with Noisebound',
    text: [
      greeting(recipient),
      '',
      "It's been a few days since you joined the Noisebound beta, and we wanted to check in.",
      '',
      `If you haven't had a chance to issue a session key or trigger your first action yet, the docs walk through it end to end: ${docsUrl}`,
      '',
      "Stuck on anything, or found a bug? Reply to this email or drop a note in the in-app feedback form — we'd love to hear from you.",
      '',
      '— The Noisebound team',
    ].join('\n'),
  };
}
