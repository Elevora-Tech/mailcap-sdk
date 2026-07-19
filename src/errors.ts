/** Thrown when required configuration is missing or contradictory (F30). */
export class MailcapConfigError extends Error {
  constructor(message: string) {
    super(`[mailcap] ${message}`);
    this.name = "MailcapConfigError";
  }
}

/**
 * Thrown when real provider delivery is attempted outside production without
 * an explicit override (F31) — the guard against emailing real people from a
 * dev machine that happens to have a real provider key configured.
 */
export class MailcapRealSendGuardError extends Error {
  constructor() {
    super(
      "[mailcap] Refusing to send real email: NODE_ENV is not 'production' and " +
        "no MAILCAP_API_KEY is set. This guards against accidentally emailing real " +
        "people from a dev/test machine. If this send is intentional, set " +
        "MAILCAP_ALLOW_REAL_SEND=true.",
    );
    this.name = "MailcapRealSendGuardError";
  }
}

/** Thrown when the capture ingest call itself fails (F4) — never a silent drop. */
export class MailcapIngestError extends Error {
  constructor(
    public readonly status: number | undefined,
    public readonly body: string,
  ) {
    super(`[mailcap] Ingest failed (status ${status ?? "n/a"}): ${body}`);
    this.name = "MailcapIngestError";
  }
}
