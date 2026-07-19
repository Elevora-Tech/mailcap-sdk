import type { EmailMessage } from "../schema.js";

export interface DeliveryResult {
  id: string;
}

export interface ProviderAdapter {
  name: string;
  deliver(message: EmailMessage): Promise<DeliveryResult>;
}

export class ProviderDeliveryError extends Error {
  constructor(
    public readonly provider: string,
    public readonly status: number | undefined,
    public readonly body: string,
  ) {
    super(`[mailcap] ${provider} delivery failed (status ${status ?? "n/a"}): ${body}`);
    this.name = "ProviderDeliveryError";
  }
}
