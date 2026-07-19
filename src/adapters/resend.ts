import type { EmailMessage } from "../schema.js";
import { ProviderDeliveryError, type DeliveryResult, type ProviderAdapter } from "./types.js";

function toAttachmentPayload(message: EmailMessage) {
  if (!message.attachments?.length) return undefined;
  return message.attachments.map((a) => ({
    filename: a.filename,
    content: a.content,
    content_type: a.contentType,
  }));
}

export function createResendAdapter(apiKey: string): ProviderAdapter {
  return {
    name: "resend",
    async deliver(message: EmailMessage): Promise<DeliveryResult> {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
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
          attachments: toAttachmentPayload(message),
        }),
      });

      if (!res.ok) {
        throw new ProviderDeliveryError("resend", res.status, await res.text());
      }

      const data = (await res.json()) as { id: string };
      return { id: data.id };
    },
  };
}
