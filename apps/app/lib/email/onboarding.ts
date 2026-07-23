import { composeActivationFollowUpEmail, composeWelcomeEmail, DEFAULT_DOCS_URL } from './templates';
import type { EmailMessage, EmailRecipient } from './types';

/**
 * TODO(founder): wire this to a real send path once Zoho credentials are
 * available (SMTP or the Zoho Mail API). Deliberately not implemented yet —
 * calling this today is a no-op that only records intent to send.
 */
export async function sendEmail(message: EmailMessage): Promise<void> {
  void message;
}

/** Composes and (stub-)sends the immediate welcome email for a new beta signup. */
export async function triggerWelcomeEmail(
  recipient: EmailRecipient,
  docsUrl: string = DEFAULT_DOCS_URL,
): Promise<EmailMessage> {
  const message = composeWelcomeEmail(recipient, docsUrl);
  await sendEmail(message);
  return message;
}

/**
 * Composes and (stub-)sends the 3-day activation follow-up. Not wired to a
 * scheduler yet — callers are expected to invoke this from a future
 * cron/queue trigger once one exists, passing the same recipient used for
 * the welcome email.
 */
export async function triggerActivationFollowUpEmail(
  recipient: EmailRecipient,
  docsUrl: string = DEFAULT_DOCS_URL,
): Promise<EmailMessage> {
  const message = composeActivationFollowUpEmail(recipient, docsUrl);
  await sendEmail(message);
  return message;
}
