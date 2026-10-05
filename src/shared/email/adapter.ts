import crypto from "node:crypto";

export type EmailMessage = {
  to: string;
  template: string;
  data: Record<string, unknown>;
  /** Passed to the provider so a resend after a crash is deduplicated provider-side. */
  idempotencyKey: string;
};

export type EmailSendResult = { providerMessageId: string };

export interface EmailAdapter {
  send(message: EmailMessage): Promise<EmailSendResult>;
}

/**
 * In-memory adapter for dev/test. Never contacts a real provider.
 * Honours idempotencyKey like a real provider would.
 */
export class SandboxEmailAdapter implements EmailAdapter {
  readonly sent: EmailMessage[] = [];
  private readonly byKey = new Map<string, EmailSendResult>();

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const existing = this.byKey.get(message.idempotencyKey);
    if (existing) return existing;
    const result = { providerMessageId: `sandbox-${crypto.randomUUID()}` };
    this.byKey.set(message.idempotencyKey, result);
    this.sent.push(message);
    return result;
  }
}

/** Resolves the configured adapter. Only the sandbox exists until a provider is approved. */
export function createEmailAdapter(env: NodeJS.ProcessEnv = process.env): EmailAdapter {
  const kind = env.EMAIL_ADAPTER ?? (env.NODE_ENV === "production" ? undefined : "sandbox");
  if (kind === "sandbox") return new SandboxEmailAdapter();
  throw new Error(`Email adapter not configured: ${kind ?? "unset"}`);
}

