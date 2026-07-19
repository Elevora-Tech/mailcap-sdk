import type { EmailMessage, TemplateRef } from "./schema.js";
import { emailMessageSchema } from "./schema.js";
import {
  assertRealSendAllowed,
  deliverToCapture,
  readConfigFromEnv,
  type MailcapConfig,
} from "./mailer.js";

/**
 * F36 — brownfield integration for codebases that already call a provider
 * SDK directly at many call sites (Thriveworks' notification service calls
 * `mailgun.messages.create(domain, { template, "t:variables", ... })` at
 * ~15 sites with no shared wrapper). Rewriting every call site to adopt
 * `sendEmail()` is real, risky work a team can reasonably refuse — these
 * wrappers let the migration touch only the client construction line.
 */

// ---------------------------------------------------------------------------
// F36b: manual escape hatch, for call shapes the wrappers below don't fit.
// ---------------------------------------------------------------------------

/** Pure boolean check — true when MAILCAP_API_KEY is set (capture is active). */
export function isMailcapCaptureEnabled(overrides: Partial<MailcapConfig> = {}): boolean {
  const config = { ...readConfigFromEnv(), ...overrides };
  return Boolean(config.captureApiKey);
}

/**
 * POSTs an already-shared-schema-shaped message to Mailcap ingest directly,
 * without going through a provider translator. Use this to hand-write your
 * own `if (isMailcapCaptureEnabled()) { ... } else { <existing call> }` gate
 * around code that neither `sendEmail()` nor the wrap-mode adapters below
 * fit cleanly.
 */
export async function captureRaw(
  message: EmailMessage,
  overrides: Partial<MailcapConfig> = {},
): Promise<{ id: string }> {
  const config = { ...readConfigFromEnv(), ...overrides };
  const validated = emailMessageSchema.parse(message);
  const result = await deliverToCapture(validated, config);
  return { id: result.id };
}

// ---------------------------------------------------------------------------
// F36a: provider-client wrap mode — drop-in proxies matching each provider's
// native call shape, so only the client construction line changes.
// ---------------------------------------------------------------------------

function normalizeRecipients(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") return value.split(",").map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === "string" ? v : (v as { email: string }).email));
  }
  return [];
}

// --- Mailgun -----------------------------------------------------------

export interface MailgunLikeClient {
  messages: {
    create: (domain: string, data: Record<string, unknown>) => Promise<unknown>;
  };
}

function mailgunPayloadToMessage(data: Record<string, unknown>): EmailMessage {
  const template: TemplateRef | undefined = data.template
    ? {
        id: String(data.template),
        provider: "mailgun",
        data: data["t:variables"]
          ? (JSON.parse(String(data["t:variables"])) as Record<string, unknown>)
          : undefined,
      }
    : undefined;

  return emailMessageSchema.parse({
    from: data.from,
    to: normalizeRecipients(data.to),
    cc: normalizeRecipients(data.cc),
    bcc: normalizeRecipients(data.bcc),
    subject: data.subject,
    html: data.html as string | undefined,
    text: data.text as string | undefined,
    template,
  });
}

/**
 * Wraps an existing `mailgun.js` client (`new Mailgun(formData).client({...})`).
 * `wrapped.messages.create(domain, data)` — identical call shape — captures
 * in dev/staging, delivers for real in production, exactly like `sendEmail`.
 */
export function wrapMailgunClient(
  client: MailgunLikeClient,
  overrides: Partial<MailcapConfig> = {},
): MailgunLikeClient {
  return {
    messages: {
      async create(domain: string, data: Record<string, unknown>) {
        const config = { ...readConfigFromEnv(), ...overrides };
        if (config.captureApiKey) {
          const message = mailgunPayloadToMessage(data);
          const result = await deliverToCapture(message, config);
          return { id: result.id, message: "Queued. Thank you." };
        }
        assertRealSendAllowed(config);
        return client.messages.create(domain, data);
      },
    },
  };
}

// --- SendGrid ------------------------------------------------------------

export interface SendGridLikeClient {
  send: (msg: Record<string, unknown>) => Promise<unknown>;
}

function sendgridPayloadToMessage(msg: Record<string, unknown>): EmailMessage {
  const personalizations = msg.personalizations as
    | Array<{ to?: unknown; cc?: unknown; bcc?: unknown }>
    | undefined;
  const first = personalizations?.[0];

  const template: TemplateRef | undefined = msg.templateId
    ? {
        id: String(msg.templateId),
        provider: "sendgrid",
        data: msg.dynamicTemplateData as Record<string, unknown> | undefined,
      }
    : undefined;

  const from = typeof msg.from === "string" ? msg.from : (msg.from as { email: string })?.email;

  return emailMessageSchema.parse({
    from,
    to: normalizeRecipients(first?.to ?? msg.to),
    cc: normalizeRecipients(first?.cc ?? msg.cc),
    bcc: normalizeRecipients(first?.bcc ?? msg.bcc),
    subject: msg.subject,
    html: msg.html as string | undefined,
    text: msg.text as string | undefined,
    template,
  });
}

/**
 * Wraps an existing `@sendgrid/mail` client (`sgMail` after `.setApiKey(...)`).
 * `wrapped.send(msg)` — identical call shape — captures in dev/staging,
 * delivers for real in production, exactly like `sendEmail`.
 */
export function wrapSendGridClient(
  client: SendGridLikeClient,
  overrides: Partial<MailcapConfig> = {},
): SendGridLikeClient {
  return {
    async send(msg: Record<string, unknown>) {
      const config = { ...readConfigFromEnv(), ...overrides };
      if (config.captureApiKey) {
        const message = sendgridPayloadToMessage(msg);
        const result = await deliverToCapture(message, config);
        return [{ statusCode: 202, headers: { "x-message-id": result.id } }, {}];
      }
      assertRealSendAllowed(config);
      return client.send(msg);
    },
  };
}

// --- Resend ----------------------------------------------------------------

export interface ResendLikeClient {
  emails: {
    send: (payload: Record<string, unknown>) => Promise<unknown>;
  };
}

function resendPayloadToMessage(payload: Record<string, unknown>): EmailMessage {
  return emailMessageSchema.parse({
    from: payload.from,
    to: normalizeRecipients(payload.to),
    cc: normalizeRecipients(payload.cc),
    bcc: normalizeRecipients(payload.bcc),
    subject: payload.subject,
    html: payload.html as string | undefined,
    text: payload.text as string | undefined,
  });
}

/**
 * Wraps an existing `resend` client (`new Resend(apiKey)`).
 * `wrapped.emails.send(payload)` — identical call shape — captures in
 * dev/staging, delivers for real in production, exactly like `sendEmail`.
 */
export function wrapResendClient(
  client: ResendLikeClient,
  overrides: Partial<MailcapConfig> = {},
): ResendLikeClient {
  return {
    emails: {
      async send(payload: Record<string, unknown>) {
        const config = { ...readConfigFromEnv(), ...overrides };
        if (config.captureApiKey) {
          const message = resendPayloadToMessage(payload);
          const result = await deliverToCapture(message, config);
          return { data: { id: result.id }, error: null };
        }
        assertRealSendAllowed(config);
        return client.emails.send(payload);
      },
    },
  };
}
