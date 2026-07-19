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
      "[mailcap] Refusing to send: NODE_ENV is not 'production' and no MAILCAP_API_KEY " +
        "is set, so this send would otherwise go out to a REAL recipient from a dev/test " +
        "machine. Most likely fix: set MAILCAP_API_KEY (+ MAILCAP_URL) to capture instead. " +
        "If you actually intend to send real email from here, set " +
        "MAILCAP_ALLOW_REAL_SEND=true — note this check runs before provider config is " +
        "validated, so you may see a follow-up error about MAIL_PROVIDER once this guard " +
        "is satisfied.",
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
