import type { EmailMessage } from "../schema.js";
import { ProviderDeliveryError, type DeliveryResult, type ProviderAdapter } from "./types.js";

function toAttachmentPayload(message: EmailMessage) {
  if (!message.attachments?.length) return undefined;
  return message.attachments.map((a) => ({
    filename: a.filename,
    content: a.content,
    type: a.contentType,
  }));
}

function toHeadersPayload(message: EmailMessage) {
  if (!message.headers) return undefined;
  return message.headers;
}

export function createSendGridAdapter(apiKey: string): ProviderAdapter {
  return {
    name: "sendgrid",
    async deliver(message: EmailMessage): Promise<DeliveryResult> {
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [
            {
              to: message.to.map((email) => ({ email })),
              cc: message.cc?.map((email) => ({ email })),
              bcc: message.bcc?.map((email) => ({ email })),
            },
          ],
          from: { email: message.from },
          subject: message.subject,
          content: [
            message.text ? { type: "text/plain", value: message.text } : null,
            message.html ? { type: "text/html", value: message.html } : null,
          ].filter((c): c is { type: string; value: string } => c !== null),
          headers: toHeadersPayload(message),
          attachments: toAttachmentPayload(message),
        }),
      });

      if (!res.ok) {
        throw new ProviderDeliveryError("sendgrid", res.status, await res.text());
      }

      // SendGrid returns the message id in the X-Message-Id response header,
      // not in the (empty) 202 body.
      const id = res.headers.get("x-message-id") ?? crypto.randomUUID();
      return { id };
    },
  };
}
