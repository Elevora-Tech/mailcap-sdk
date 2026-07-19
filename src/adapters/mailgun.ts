import type { EmailMessage } from "../schema.js";
import { ProviderDeliveryError, type DeliveryResult, type ProviderAdapter } from "./types.js";

export interface MailgunConfig {
  apiKey: string;
  domain: string;
  /** Mailgun has US and EU regions with different API hosts. Defaults to US. */
  region?: "us" | "eu";
}

function base64ToBlob(content: string, contentType: string): Blob {
  const binary = atob(content);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes as unknown as BlobPart], { type: contentType });
}

export function createMailgunAdapter(config: MailgunConfig): ProviderAdapter {
  const host = config.region === "eu" ? "api.eu.mailgun.net" : "api.mailgun.net";

  return {
    name: "mailgun",
    async deliver(message: EmailMessage): Promise<DeliveryResult> {
      const form = new FormData();
      form.append("from", message.from);
      for (const to of message.to) form.append("to", to);
      for (const cc of message.cc ?? []) form.append("cc", cc);
      for (const bcc of message.bcc ?? []) form.append("bcc", bcc);
      form.append("subject", message.subject);
      if (message.text) form.append("text", message.text);
      if (message.html) form.append("html", message.html);
      for (const [key, value] of Object.entries(message.headers ?? {})) {
        form.append(`h:${key}`, value);
      }
      for (const attachment of message.attachments ?? []) {
        form.append(
          "attachment",
          base64ToBlob(attachment.content, attachment.contentType),
          attachment.filename,
        );
      }

      const res = await fetch(`https://${host}/v3/${config.domain}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`api:${config.apiKey}`)}`,
        },
        body: form,
      });

      if (!res.ok) {
        throw new ProviderDeliveryError("mailgun", res.status, await res.text());
      }

      const data = (await res.json()) as { id: string };
      return { id: data.id };
    },
  };
}
