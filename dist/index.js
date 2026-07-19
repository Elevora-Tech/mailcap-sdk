// src/schema.ts
import { z } from "zod";
var attachmentSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  /** Base64-encoded content. Total message size is capped by the service (F5, 10MB). */
  content: z.string().min(1)
});
var templateRefSchema = z.object({
  id: z.string().min(1),
  provider: z.enum(["mailgun", "sendgrid"]).optional(),
  data: z.record(z.string(), z.unknown()).optional()
});
var emailMessageSchema = z.object({
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
  messageId: z.string().optional()
}).refine((msg) => msg.html !== void 0 || msg.text !== void 0 || msg.template !== void 0, {
  message: "Message must have at least one of html, text, or template."
});
var ingestResponseSchema = z.object({
  id: z.string()
});

// src/errors.ts
var MailcapConfigError = class extends Error {
  constructor(message) {
    super(`[mailcap] ${message}`);
    this.name = "MailcapConfigError";
  }
};
var MailcapRealSendGuardError = class extends Error {
  constructor() {
    super(
      "[mailcap] Refusing to send: NODE_ENV is not 'production' and no MAILCAP_API_KEY is set, so this send would otherwise go out to a REAL recipient from a dev/test machine. Most likely fix: set MAILCAP_API_KEY (+ MAILCAP_URL) to capture instead. If you actually intend to send real email from here, set MAILCAP_ALLOW_REAL_SEND=true \u2014 note this check runs before provider config is validated, so you may see a follow-up error about MAIL_PROVIDER once this guard is satisfied."
    );
    this.name = "MailcapRealSendGuardError";
  }
};
var MailcapIngestError = class extends Error {
  constructor(status, body) {
    super(`[mailcap] Ingest failed (status ${status ?? "n/a"}): ${body}`);
    this.status = status;
    this.body = body;
    this.name = "MailcapIngestError";
  }
  status;
  body;
};

// src/adapters/types.ts
var ProviderDeliveryError = class extends Error {
  constructor(provider, status, body) {
    super(`[mailcap] ${provider} delivery failed (status ${status ?? "n/a"}): ${body}`);
    this.provider = provider;
    this.status = status;
    this.body = body;
    this.name = "ProviderDeliveryError";
  }
  provider;
  status;
  body;
};

// src/adapters/resend.ts
function toAttachmentPayload(message) {
  if (!message.attachments?.length) return void 0;
  return message.attachments.map((a) => ({
    filename: a.filename,
    content: a.content,
    content_type: a.contentType
  }));
}
function createResendAdapter(apiKey) {
  return {
    name: "resend",
    async deliver(message) {
      if (message.template && !message.html && !message.text) {
        throw new MailcapConfigError(
          "Resend has no provider-side template API \u2014 it has no `template` to deliver via. Render html client-side (e.g. React Email) before sending, or switch MAIL_PROVIDER to mailgun/sendgrid for this message."
        );
      }
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: message.from,
          to: message.to,
          cc: message.cc,
          bcc: message.bcc,
          subject: message.subject,
          html: message.html,
          text: message.text,
          headers: message.headers,
          attachments: toAttachmentPayload(message)
        })
      });
      if (!res.ok) {
        throw new ProviderDeliveryError("resend", res.status, await res.text());
      }
      const data = await res.json();
      return { id: data.id };
    }
  };
}

// src/adapters/sendgrid.ts
function toAttachmentPayload2(message) {
  if (!message.attachments?.length) return void 0;
  return message.attachments.map((a) => ({
    filename: a.filename,
    content: a.content,
    type: a.contentType
  }));
}
function toHeadersPayload(message) {
  if (!message.headers) return void 0;
  return message.headers;
}
function createSendGridAdapter(apiKey) {
  return {
    name: "sendgrid",
    async deliver(message) {
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          personalizations: [
            {
              to: message.to.map((email) => ({ email })),
              cc: message.cc?.map((email) => ({ email })),
              bcc: message.bcc?.map((email) => ({ email }))
            }
          ],
          from: { email: message.from },
          subject: message.subject,
          content: message.text || message.html ? [
            message.text ? { type: "text/plain", value: message.text } : null,
            message.html ? { type: "text/html", value: message.html } : null
          ].filter((c) => c !== null) : void 0,
          template_id: message.template?.provider === "sendgrid" ? message.template.id : void 0,
          dynamic_template_data: message.template?.provider === "sendgrid" ? message.template.data : void 0,
          headers: toHeadersPayload(message),
          attachments: toAttachmentPayload2(message)
        })
      });
      if (!res.ok) {
        throw new ProviderDeliveryError("sendgrid", res.status, await res.text());
      }
      const id = res.headers.get("x-message-id") ?? crypto.randomUUID();
      return { id };
    }
  };
}

// src/adapters/mailgun.ts
function base64ToBlob(content, contentType) {
  const binary = atob(content);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: contentType });
}
function createMailgunAdapter(config) {
  const host = config.region === "eu" ? "api.eu.mailgun.net" : "api.mailgun.net";
  return {
    name: "mailgun",
    async deliver(message) {
      const form = new FormData();
      form.append("from", message.from);
      for (const to of message.to) form.append("to", to);
      for (const cc of message.cc ?? []) form.append("cc", cc);
      for (const bcc of message.bcc ?? []) form.append("bcc", bcc);
      form.append("subject", message.subject);
      if (message.text) form.append("text", message.text);
      if (message.html) form.append("html", message.html);
      if (message.template?.provider === "mailgun") {
        form.append("template", message.template.id);
        if (message.template.data) {
          form.append("t:variables", JSON.stringify(message.template.data));
        }
      }
      for (const [key, value] of Object.entries(message.headers ?? {})) {
        form.append(`h:${key}`, value);
      }
      for (const attachment of message.attachments ?? []) {
        form.append(
          "attachment",
          base64ToBlob(attachment.content, attachment.contentType),
          attachment.filename
        );
      }
      const res = await fetch(`https://${host}/v3/${config.domain}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`api:${config.apiKey}`)}`
        },
        body: form
      });
      if (!res.ok) {
        throw new ProviderDeliveryError("mailgun", res.status, await res.text());
      }
      const data = await res.json();
      return { id: data.id };
    }
  };
}

// src/mailer.ts
function readConfigFromEnv() {
  const env = typeof process !== "undefined" ? process.env : {};
  return {
    captureApiKey: env.MAILCAP_API_KEY,
    captureUrl: env.MAILCAP_URL,
    provider: env.MAIL_PROVIDER,
    resendApiKey: env.RESEND_API_KEY,
    sendgridApiKey: env.SENDGRID_API_KEY,
    mailgunApiKey: env.MAILGUN_API_KEY,
    mailgunDomain: env.MAILGUN_DOMAIN,
    mailgunRegion: env.MAILGUN_REGION,
    nodeEnv: env.NODE_ENV,
    allowRealSend: env.MAILCAP_ALLOW_REAL_SEND === "true"
  };
}
function resolveAdapter(config) {
  if (!config.provider) {
    throw new MailcapConfigError(
      "No capture key present and MAIL_PROVIDER is not set. Set MAILCAP_API_KEY to capture, or set MAIL_PROVIDER=resend|sendgrid|mailgun plus that provider's API key to deliver for real."
    );
  }
  switch (config.provider) {
    case "resend": {
      if (!config.resendApiKey) {
        throw new MailcapConfigError(
          "MAIL_PROVIDER=resend but RESEND_API_KEY is not set."
        );
      }
      return createResendAdapter(config.resendApiKey);
    }
    case "sendgrid": {
      if (!config.sendgridApiKey) {
        throw new MailcapConfigError(
          "MAIL_PROVIDER=sendgrid but SENDGRID_API_KEY is not set."
        );
      }
      return createSendGridAdapter(config.sendgridApiKey);
    }
    case "mailgun": {
      if (!config.mailgunApiKey) {
        throw new MailcapConfigError(
          "MAIL_PROVIDER=mailgun but MAILGUN_API_KEY is not set."
        );
      }
      if (!config.mailgunDomain) {
        throw new MailcapConfigError(
          "MAIL_PROVIDER=mailgun but MAILGUN_DOMAIN is not set."
        );
      }
      return createMailgunAdapter({
        apiKey: config.mailgunApiKey,
        domain: config.mailgunDomain,
        region: config.mailgunRegion
      });
    }
    default:
      throw new MailcapConfigError(
        `MAIL_PROVIDER=${String(config.provider)} is not a recognized provider (expected resend, sendgrid, or mailgun).`
      );
  }
}
async function deliverToCapture(message, config) {
  if (!config.captureUrl) {
    throw new MailcapConfigError(
      "MAILCAP_API_KEY is set but MAILCAP_URL is not \u2014 cannot reach the Mailcap service."
    );
  }
  const res = await fetch(new URL("/api/ingest", config.captureUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.captureApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(message)
  });
  if (!res.ok) {
    throw new MailcapIngestError(res.status, await res.text());
  }
  const parsed = ingestResponseSchema.parse(await res.json());
  return { id: parsed.id, mode: "captured" };
}
function assertRealSendAllowed(config) {
  const nodeEnv = config.nodeEnv ?? "development";
  if (nodeEnv !== "production" && !config.allowRealSend) {
    throw new MailcapRealSendGuardError();
  }
}
async function deliverToProvider(message, config) {
  assertRealSendAllowed(config);
  const adapter = resolveAdapter(config);
  const result = await adapter.deliver(message);
  return { id: result.id, mode: "delivered", provider: config.provider };
}
function createMailer(overrides = {}) {
  const config = { ...readConfigFromEnv(), ...overrides };
  return {
    async send(message) {
      const validated = emailMessageSchema.parse(message);
      if (config.captureApiKey) {
        return deliverToCapture(validated, config);
      }
      return deliverToProvider(validated, config);
    }
  };
}
var defaultMailer;
function sendEmail(message) {
  if (!defaultMailer) {
    defaultMailer = createMailer();
  }
  return defaultMailer.send(message);
}
function __resetDefaultMailer() {
  defaultMailer = void 0;
}

// src/wrap.ts
function isMailcapCaptureEnabled(overrides = {}) {
  const config = { ...readConfigFromEnv(), ...overrides };
  return Boolean(config.captureApiKey);
}
async function captureRaw(message, overrides = {}) {
  const config = { ...readConfigFromEnv(), ...overrides };
  const validated = emailMessageSchema.parse(message);
  const result = await deliverToCapture(validated, config);
  return { id: result.id };
}
function normalizeRecipients(value) {
  if (!value) return [];
  if (typeof value === "string") return value.split(",").map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(value)) {
    return value.map((v) => typeof v === "string" ? v : v.email);
  }
  return [];
}
function mailgunPayloadToMessage(data) {
  const template = data.template ? {
    id: String(data.template),
    provider: "mailgun",
    data: data["t:variables"] ? JSON.parse(String(data["t:variables"])) : void 0
  } : void 0;
  return emailMessageSchema.parse({
    from: data.from,
    to: normalizeRecipients(data.to),
    cc: normalizeRecipients(data.cc),
    bcc: normalizeRecipients(data.bcc),
    subject: data.subject,
    html: data.html,
    text: data.text,
    template
  });
}
function wrapMailgunClient(client, overrides = {}) {
  return {
    messages: {
      async create(domain, data) {
        const config = { ...readConfigFromEnv(), ...overrides };
        if (config.captureApiKey) {
          const message = mailgunPayloadToMessage(data);
          const result = await deliverToCapture(message, config);
          return { id: result.id, message: "Queued. Thank you." };
        }
        assertRealSendAllowed(config);
        return client.messages.create(domain, data);
      }
    }
  };
}
function sendgridPayloadToMessage(msg) {
  const personalizations = msg.personalizations;
  const first = personalizations?.[0];
  const template = msg.templateId ? {
    id: String(msg.templateId),
    provider: "sendgrid",
    data: msg.dynamicTemplateData
  } : void 0;
  const from = typeof msg.from === "string" ? msg.from : msg.from?.email;
  return emailMessageSchema.parse({
    from,
    to: normalizeRecipients(first?.to ?? msg.to),
    cc: normalizeRecipients(first?.cc ?? msg.cc),
    bcc: normalizeRecipients(first?.bcc ?? msg.bcc),
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    template
  });
}
function wrapSendGridClient(client, overrides = {}) {
  return {
    async send(msg) {
      const config = { ...readConfigFromEnv(), ...overrides };
      if (config.captureApiKey) {
        const message = sendgridPayloadToMessage(msg);
        const result = await deliverToCapture(message, config);
        return [{ statusCode: 202, headers: { "x-message-id": result.id } }, {}];
      }
      assertRealSendAllowed(config);
      return client.send(msg);
    }
  };
}
function resendPayloadToMessage(payload) {
  return emailMessageSchema.parse({
    from: payload.from,
    to: normalizeRecipients(payload.to),
    cc: normalizeRecipients(payload.cc),
    bcc: normalizeRecipients(payload.bcc),
    subject: payload.subject,
    html: payload.html,
    text: payload.text
  });
}
function wrapResendClient(client, overrides = {}) {
  return {
    emails: {
      async send(payload) {
        const config = { ...readConfigFromEnv(), ...overrides };
        if (config.captureApiKey) {
          const message = resendPayloadToMessage(payload);
          const result = await deliverToCapture(message, config);
          return { data: { id: result.id }, error: null };
        }
        assertRealSendAllowed(config);
        return client.emails.send(payload);
      }
    }
  };
}
export {
  MailcapConfigError,
  MailcapIngestError,
  MailcapRealSendGuardError,
  ProviderDeliveryError,
  __resetDefaultMailer,
  attachmentSchema,
  captureRaw,
  createMailer,
  createMailgunAdapter,
  createResendAdapter,
  createSendGridAdapter,
  emailMessageSchema,
  ingestResponseSchema,
  isMailcapCaptureEnabled,
  sendEmail,
  templateRefSchema,
  wrapMailgunClient,
  wrapResendClient,
  wrapSendGridClient
};
