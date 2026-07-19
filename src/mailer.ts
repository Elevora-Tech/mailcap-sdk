import { emailMessageSchema, ingestResponseSchema, type EmailMessage } from "./schema.js";
import { createResendAdapter } from "./adapters/resend.js";
import { createSendGridAdapter } from "./adapters/sendgrid.js";
import { createMailgunAdapter } from "./adapters/mailgun.js";
import type { ProviderAdapter } from "./adapters/types.js";
import { MailcapConfigError, MailcapIngestError, MailcapRealSendGuardError } from "./errors.js";

export type MailProvider = "resend" | "sendgrid" | "mailgun";

export interface MailcapConfig {
  /** Presence of this key routes sends to Mailcap capture instead of real delivery. */
  captureApiKey?: string;
  captureUrl?: string;
  provider?: MailProvider;
  resendApiKey?: string;
  sendgridApiKey?: string;
  mailgunApiKey?: string;
  mailgunDomain?: string;
  mailgunRegion?: "us" | "eu";
  /** Defaults to process.env.NODE_ENV. Overridable for tests. */
  nodeEnv?: string;
  /** Escape hatch for F31's guard — real delivery outside production requires this. */
  allowRealSend?: boolean;
}

export interface SendResult {
  id: string;
  mode: "captured" | "delivered";
  provider?: MailProvider;
}

export interface Mailer {
  send(message: EmailMessage): Promise<SendResult>;
}

function readConfigFromEnv(): MailcapConfig {
  const env = typeof process !== "undefined" ? process.env : {};
  return {
    captureApiKey: env.MAILCAP_API_KEY,
    captureUrl: env.MAILCAP_URL,
    provider: env.MAIL_PROVIDER as MailProvider | undefined,
    resendApiKey: env.RESEND_API_KEY,
    sendgridApiKey: env.SENDGRID_API_KEY,
    mailgunApiKey: env.MAILGUN_API_KEY,
    mailgunDomain: env.MAILGUN_DOMAIN,
    mailgunRegion: env.MAILGUN_REGION as "us" | "eu" | undefined,
    nodeEnv: env.NODE_ENV,
    allowRealSend: env.MAILCAP_ALLOW_REAL_SEND === "true",
  };
}

function resolveAdapter(config: MailcapConfig): ProviderAdapter {
  if (!config.provider) {
    throw new MailcapConfigError(
      "No capture key present and MAIL_PROVIDER is not set. Set MAILCAP_API_KEY to " +
        "capture, or set MAIL_PROVIDER=resend|sendgrid|mailgun plus that provider's " +
        "API key to deliver for real.",
    );
  }

  switch (config.provider) {
    case "resend": {
      if (!config.resendApiKey) {
        throw new MailcapConfigError(
          "MAIL_PROVIDER=resend but RESEND_API_KEY is not set.",
        );
      }
      return createResendAdapter(config.resendApiKey);
    }
    case "sendgrid": {
      if (!config.sendgridApiKey) {
        throw new MailcapConfigError(
          "MAIL_PROVIDER=sendgrid but SENDGRID_API_KEY is not set.",
        );
      }
      return createSendGridAdapter(config.sendgridApiKey);
    }
    case "mailgun": {
      if (!config.mailgunApiKey) {
        throw new MailcapConfigError(
          "MAIL_PROVIDER=mailgun but MAILGUN_API_KEY is not set.",
        );
      }
      if (!config.mailgunDomain) {
        throw new MailcapConfigError(
          "MAIL_PROVIDER=mailgun but MAILGUN_DOMAIN is not set.",
        );
      }
      return createMailgunAdapter({
        apiKey: config.mailgunApiKey,
        domain: config.mailgunDomain,
        region: config.mailgunRegion,
      });
    }
    default:
      throw new MailcapConfigError(
        `MAIL_PROVIDER=${String(config.provider)} is not a recognized provider ` +
          `(expected resend, sendgrid, or mailgun).`,
      );
  }
}

async function deliverToCapture(
  message: EmailMessage,
  config: MailcapConfig,
): Promise<SendResult> {
  if (!config.captureUrl) {
    throw new MailcapConfigError(
      "MAILCAP_API_KEY is set but MAILCAP_URL is not — cannot reach the Mailcap service.",
    );
  }

  const res = await fetch(new URL("/api/ingest", config.captureUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.captureApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });

  if (!res.ok) {
    // F4: ingest never silently drops an email — the caller always sees a failure.
    throw new MailcapIngestError(res.status, await res.text());
  }

  const parsed = ingestResponseSchema.parse(await res.json());
  return { id: parsed.id, mode: "captured" };
}

async function deliverToProvider(
  message: EmailMessage,
  config: MailcapConfig,
): Promise<SendResult> {
  // F31: refuse real delivery outside production unless explicitly overridden.
  const nodeEnv = config.nodeEnv ?? "development";
  if (nodeEnv !== "production" && !config.allowRealSend) {
    throw new MailcapRealSendGuardError();
  }

  const adapter = resolveAdapter(config);
  const result = await adapter.deliver(message);
  return { id: result.id, mode: "delivered", provider: config.provider };
}

/**
 * Builds a Mailer from explicit config (falls back to env vars for anything
 * not overridden). Prefer this in tests or when a project needs more than one
 * mailer instance; most app code should use the top-level `sendEmail` instead.
 */
export function createMailer(overrides: Partial<MailcapConfig> = {}): Mailer {
  const config: MailcapConfig = { ...readConfigFromEnv(), ...overrides };

  return {
    async send(message: EmailMessage): Promise<SendResult> {
      const validated = emailMessageSchema.parse(message);

      // F9: capture is opt-in by env var presence alone — no mode flag that
      // could be misconfigured to capture in prod or deliver in dev.
      if (config.captureApiKey) {
        return deliverToCapture(validated, config);
      }
      return deliverToProvider(validated, config);
    },
  };
}

let defaultMailer: Mailer | undefined;

/**
 * The one function app code calls, identical in every environment (F30).
 * Env vars alone decide whether this captures or delivers for real.
 */
export function sendEmail(message: EmailMessage): Promise<SendResult> {
  if (!defaultMailer) {
    defaultMailer = createMailer();
  }
  return defaultMailer.send(message);
}

/** Test-only escape hatch to reset the memoized default mailer between env changes. */
export function __resetDefaultMailer(): void {
  defaultMailer = undefined;
}
