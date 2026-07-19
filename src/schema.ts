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

export const emailMessageSchema = z.object({
  from: z.string().email(),
  to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  subject: z.string().min(1),
  html: z.string().optional(),
  text: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  attachments: z.array(attachmentSchema).optional(),
  /** Optional client-supplied id for idempotency (F7). */
  messageId: z.string().optional(),
});

export type EmailMessage = z.infer<typeof emailMessageSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;

export const ingestResponseSchema = z.object({
  id: z.string(),
});

export type IngestResponse = z.infer<typeof ingestResponseSchema>;
