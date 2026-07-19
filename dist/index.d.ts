import { z } from 'zod';

/**
 * Single source of truth for the email message shape (spec F10).
 * The Mailcap service imports this same schema to validate /api/ingest,
 * so SDK and service can never drift silently — a shape mismatch is a
 * validation error, not a bug discovered in production.
 */
declare const attachmentSchema: z.ZodObject<{
    filename: z.ZodString;
    contentType: z.ZodString;
    /** Base64-encoded content. Total message size is capped by the service (F5, 10MB). */
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    filename: string;
    contentType: string;
    content: string;
}, {
    filename: string;
    contentType: string;
    content: string;
}>;
declare const emailMessageSchema: z.ZodObject<{
    from: z.ZodString;
    to: z.ZodArray<z.ZodString, "many">;
    cc: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    bcc: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    subject: z.ZodString;
    html: z.ZodOptional<z.ZodString>;
    text: z.ZodOptional<z.ZodString>;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    attachments: z.ZodOptional<z.ZodArray<z.ZodObject<{
        filename: z.ZodString;
        contentType: z.ZodString;
        /** Base64-encoded content. Total message size is capped by the service (F5, 10MB). */
        content: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        filename: string;
        contentType: string;
        content: string;
    }, {
        filename: string;
        contentType: string;
        content: string;
    }>, "many">>;
    /** Optional client-supplied id for idempotency (F7). */
    messageId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    from: string;
    to: string[];
    subject: string;
    cc?: string[] | undefined;
    bcc?: string[] | undefined;
    html?: string | undefined;
    text?: string | undefined;
    headers?: Record<string, string> | undefined;
    attachments?: {
        filename: string;
        contentType: string;
        content: string;
    }[] | undefined;
    messageId?: string | undefined;
}, {
    from: string;
    to: string[];
    subject: string;
    cc?: string[] | undefined;
    bcc?: string[] | undefined;
    html?: string | undefined;
    text?: string | undefined;
    headers?: Record<string, string> | undefined;
    attachments?: {
        filename: string;
        contentType: string;
        content: string;
    }[] | undefined;
    messageId?: string | undefined;
}>;
type EmailMessage = z.infer<typeof emailMessageSchema>;
type Attachment = z.infer<typeof attachmentSchema>;
declare const ingestResponseSchema: z.ZodObject<{
    id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
}, {
    id: string;
}>;
type IngestResponse = z.infer<typeof ingestResponseSchema>;

type MailProvider = "resend" | "sendgrid" | "mailgun";
interface MailcapConfig {
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
interface SendResult {
    id: string;
    mode: "captured" | "delivered";
    provider?: MailProvider;
}
interface Mailer {
    send(message: EmailMessage): Promise<SendResult>;
}
/**
 * Builds a Mailer from explicit config (falls back to env vars for anything
 * not overridden). Prefer this in tests or when a project needs more than one
 * mailer instance; most app code should use the top-level `sendEmail` instead.
 */
declare function createMailer(overrides?: Partial<MailcapConfig>): Mailer;
/**
 * The one function app code calls, identical in every environment (F30).
 * Env vars alone decide whether this captures or delivers for real.
 */
declare function sendEmail(message: EmailMessage): Promise<SendResult>;
/** Test-only escape hatch to reset the memoized default mailer between env changes. */
declare function __resetDefaultMailer(): void;

/** Thrown when required configuration is missing or contradictory (F30). */
declare class MailcapConfigError extends Error {
    constructor(message: string);
}
/**
 * Thrown when real provider delivery is attempted outside production without
 * an explicit override (F31) — the guard against emailing real people from a
 * dev machine that happens to have a real provider key configured.
 */
declare class MailcapRealSendGuardError extends Error {
    constructor();
}
/** Thrown when the capture ingest call itself fails (F4) — never a silent drop. */
declare class MailcapIngestError extends Error {
    readonly status: number | undefined;
    readonly body: string;
    constructor(status: number | undefined, body: string);
}

interface DeliveryResult {
    id: string;
}
interface ProviderAdapter {
    name: string;
    deliver(message: EmailMessage): Promise<DeliveryResult>;
}
declare class ProviderDeliveryError extends Error {
    readonly provider: string;
    readonly status: number | undefined;
    readonly body: string;
    constructor(provider: string, status: number | undefined, body: string);
}

declare function createResendAdapter(apiKey: string): ProviderAdapter;

declare function createSendGridAdapter(apiKey: string): ProviderAdapter;

interface MailgunConfig {
    apiKey: string;
    domain: string;
    /** Mailgun has US and EU regions with different API hosts. Defaults to US. */
    region?: "us" | "eu";
}
declare function createMailgunAdapter(config: MailgunConfig): ProviderAdapter;

export { type Attachment, type DeliveryResult, type EmailMessage, type IngestResponse, type MailProvider, type MailcapConfig, MailcapConfigError, MailcapIngestError, MailcapRealSendGuardError, type Mailer, type ProviderAdapter, ProviderDeliveryError, type SendResult, __resetDefaultMailer, attachmentSchema, createMailer, createMailgunAdapter, createResendAdapter, createSendGridAdapter, emailMessageSchema, ingestResponseSchema, sendEmail };
