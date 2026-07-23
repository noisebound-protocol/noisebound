export interface EmailRecipient {
  readonly email: string;
  readonly name?: string;
}

export interface EmailMessage {
  readonly to: string;
  readonly from: string;
  readonly subject: string;
  readonly text: string;
}
