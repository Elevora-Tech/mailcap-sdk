export { sendEmail, createMailer, __resetDefaultMailer } from "./mailer.js";
export type { Mailer, MailcapConfig, MailProvider, SendResult } from "./mailer.js";

export { emailMessageSchema, attachmentSchema, ingestResponseSchema, templateRefSchema } from "./schema.js";
export type { EmailMessage, Attachment, IngestResponse, TemplateRef } from "./schema.js";

export {
  isMailcapCaptureEnabled,
  captureRaw,
  wrapMailgunClient,
  wrapSendGridClient,
  wrapResendClient,
} from "./wrap.js";
export type { MailgunLikeClient, SendGridLikeClient, ResendLikeClient } from "./wrap.js";

export { MailcapConfigError, MailcapRealSendGuardError, MailcapIngestError } from "./errors.js";

export { createResendAdapter } from "./adapters/resend.js";
export { createSendGridAdapter } from "./adapters/sendgrid.js";
export { createMailgunAdapter } from "./adapters/mailgun.js";
export type { ProviderAdapter, DeliveryResult } from "./adapters/types.js";
export { ProviderDeliveryError } from "./adapters/types.js";
