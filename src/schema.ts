import { z } from "zod";

/**
 * Single source of truth for the email message shape (spec F10).
 * The Mailcap service imports this same schema to validate /api/ingest,
 * so SDK and service can never drift silently — a shape mismatch is a
 * validation error, not a bug discovered in production.
 */

export const attachmentSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  /** Base64-encoded content. Total message size is capped by the service (F5, 10MB). */
  content: z.string().min(1),
});

/**
 * Provider-side template reference (F37a) — for sends where the provider
 * renders a server-side template (Mailgun's `template` name, SendGrid's
 * `templateId`) instead of the caller supplying html/text. Mailcap has no
 * access to the real template, so it captures the reference + data and
 * falls back to a mock-template preview or a data table (F37b).
 */
export const templateRefSchema = z.object({
  id: z.string().min(1),
  provider: z.enum(["mailgun", "sendgrid"]).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const emailMessageSchema = z
  .object({
    from: z.string().email(),
    to: z.array(z.string().email()).min(1),
    cc: z.array(z.string().email()).optional(),
    bcc: z.array(z.string().email()).optional(),
    subject: z.string().min(1),
    html: z.string().optional(),
    text: z.string().optional(),
    /** Provider-side template reference — alternative to html/text (F37a). */
    template: templateRefSchema.optional(),
    headers: z.record(z.string(), z.string()).optional(),
    attachments: z.array(attachmentSchema).optional(),
    /** Optional client-supplied id for idempotency (F7). */
    messageId: z.string().optional(),
  })
  .refine((msg) => msg.html !== undefined || msg.text !== undefined || msg.template !== undefined, {
    message: "Message must have at least one of html, text, or template.",
  });

export type EmailMessage = z.infer<typeof emailMessageSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type TemplateRef = z.infer<typeof templateRefSchema>;

export const ingestResponseSchema = z.object({
  id: z.string(),
});

export type IngestResponse = z.infer<typeof ingestResponseSchema>;
