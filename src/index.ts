export { sendEmail, createMailer, __resetDefaultMailer } from "./mailer.js";
export type { Mailer, MailcapConfig, MailProvider, SendResult } from "./mailer.js";

export { emailMessageSchema, attachmentSchema, ingestResponseSchema } from "./schema.js";
export type { EmailMessage, Attachment, IngestResponse } from "./schema.js";

export { MailcapConfigError, MailcapRealSendGuardError, MailcapIngestError } from "./errors.js";

export { createResendAdapter } from "./adapters/resend.js";
export { createSendGridAdapter } from "./adapters/sendgrid.js";
export { createMailgunAdapter } from "./adapters/mailgun.js";
export type { ProviderAdapter, DeliveryResult } from "./adapters/types.js";
export { ProviderDeliveryError } from "./adapters/types.js";
