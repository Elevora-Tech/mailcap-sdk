# @mat/mailcap

Zero-branching email SDK. One function, identical in every environment — env
vars alone decide whether an email is captured by [Mailcap](https://github.com/mat-hiretalk/mailcap)
for local/dev/staging inspection, or delivered for real via Resend, SendGrid,
or Mailgun.

```ts
import { sendEmail } from "@mat/mailcap";

await sendEmail({ from, to, subject, html }); // or { text } / { attachments }
```

That line never changes between `local-dave`, staging, and production. What
changes is your environment configuration:

```bash
# Captured — nothing is delivered
MAILCAP_API_KEY=mc_...
MAILCAP_URL=https://mailcap.yourdomain.com

# Delivered for real (production)
MAIL_PROVIDER=resend       # or sendgrid | mailgun
RESEND_API_KEY=re_...
```

## Guarantees

- **No mode flag.** Capture activates purely from `MAILCAP_API_KEY` being
  present. There is no branch in your code that could ship the wrong way.
- **Real-send guard.** Outside `NODE_ENV=production`, real provider delivery is
  refused unless you set `MAILCAP_ALLOW_REAL_SEND=true`. A dev machine that
  happens to have a real provider key configured still can't email real people.
- **Loud misconfiguration.** Missing or contradictory env vars throw
  immediately, naming exactly what's missing — never a silent no-op.
- **Ingest failures are never silent.** If Mailcap capture fails, `sendEmail`
  rejects; your app sees the error.

## Providers

| `MAIL_PROVIDER` | Required env vars |
|---|---|
| `resend` | `RESEND_API_KEY` |
| `sendgrid` | `SENDGRID_API_KEY` |
| `mailgun` | `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, optional `MAILGUN_REGION=us\|eu` |

Switching providers is a config change only — no call-site changes.

## Advanced: explicit config

`sendEmail` reads `process.env` lazily on first call. For tests or multiple
mailer instances, use `createMailer` with explicit overrides:

```ts
import { createMailer } from "@mat/mailcap";

const mailer = createMailer({
  captureApiKey: "mc_test",
  captureUrl: "https://mailcap.example.test",
});

await mailer.send({ from, to, subject, html });
```

## Idempotency

Pass `messageId` to dedupe retries — Mailcap only stores the first delivery
for a given id within an environment:

```ts
await sendEmail({ from, to, subject, html, messageId: "signup-verify-42" });
```

## License

MIT
