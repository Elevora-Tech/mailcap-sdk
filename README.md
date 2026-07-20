# @elevora-tech/mailcap

Zero-branching email SDK. One function, identical in every environment — env
vars alone decide whether an email is captured by [Mailcap](https://github.com/mat-hiretalk/mailcap)
for local/dev/staging inspection, or delivered for real via Resend, SendGrid,
or Mailgun.

```ts
import { sendEmail } from "@elevora-tech/mailcap";

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
  This guard is checked *before* provider config is validated — so if you see
  the guard error while genuinely expecting capture, the fix is almost always
  `MAILCAP_API_KEY` (+ `MAILCAP_URL`), not the override.
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
import { createMailer } from "@elevora-tech/mailcap";

const mailer = createMailer({
  captureApiKey: "mc_test",
  captureUrl: "https://mailcap.example.test",
});

await mailer.send({ from, to, subject, html });
```

## Already have a provider client wired up everywhere?

`sendEmail()` is the ideal shape for new code, but rewriting a codebase that
already calls `mailgun.messages.create(...)` (or `@sendgrid/mail`'s `.send()`,
or Resend's `.emails.send()`) at many call sites is real, risky work you can
reasonably not want to do. Wrap the client instead — the call shape at every
existing site stays identical:

```ts
import Mailgun from "mailgun.js";
import { wrapMailgunClient } from "@elevora-tech/mailcap";

const rawClient = new Mailgun(formData).client({ username: "api", key: apiKey });
export const mailgun = wrapMailgunClient(rawClient); // <- only this line changes

// every existing call site, completely unchanged:
await mailgun.messages.create(domain, {
  from, to, subject,
  template: "login_otp_template",
  "t:variables": JSON.stringify({ otp }),
});
```

`wrapSendGridClient` and `wrapResendClient` work the same way for
`@sendgrid/mail` and `resend`. All three apply the identical capture-vs-deliver
routing, real-send guard, and loud misconfiguration errors as `sendEmail`.

For call shapes that don't fit a wrapper, there's a lower-level manual gate:

```ts
import { isMailcapCaptureEnabled, captureRaw } from "@elevora-tech/mailcap";

if (isMailcapCaptureEnabled()) {
  await captureRaw({ from, to, subject, html });
} else {
  await existingProviderCall(); // untouched
}
```

## Version compatibility — what happens when Resend/SendGrid/Mailgun update?

`wrapResendClient`, `wrapSendGridClient`, and `wrapMailgunClient` never import
the vendor SDK. Each takes a **structural type**
(`ResendLikeClient`/`SendGridLikeClient`/`MailgunLikeClient`) describing only
the one method call shape Mailcap needs — `client.emails.send(payload)`,
`client.send(msg)`, `client.messages.create(domain, data)`. There is no
version of `resend`, `@sendgrid/mail`, or `mailgun.js` pinned anywhere in this
package, so there's nothing in mailcap-sdk to upgrade in lockstep with those
vendors.

In practice that means:

- **Internal vendor changes are invisible to Mailcap.** New optional params,
  auth changes, retry logic, bundling changes — none of it touches the
  wrapper, because the wrapper never calls into vendor internals, only the one
  public method it wraps.
- **The only thing that can break a wrapper** is the vendor changing the
  *shape* Mailcap depends on: the method name/signature itself, or a payload
  field name the translator reads (e.g. SendGrid's `personalizations`,
  `templateId`, `dynamicTemplateData`; Mailgun's `template` / `t:variables`).
  These are long-stable, publicly documented wire shapes, not implementation
  details — vendors change them rarely and usually only in a major version.
- **If that ever does happen**, it fails loudly, not silently:
  `emailMessageSchema.parse` throws on missing/malformed required fields
  rather than shipping a half-populated capture. You'd see a validation error
  pointing at the exact field, not a mysteriously empty inbox entry.
- **Your existing call sites are unaffected either way** — you're still
  calling the vendor client the same way; the wrapper just intercepts the one
  method. Upgrading the vendor package in your own app is a decision you make
  independently of Mailcap.

## Provider-side templates

Some providers render from a template stored on their side rather than an
`html` string you supply — Mailgun's `template` name + `t:variables`,
SendGrid's `templateId` + `dynamicTemplateData`. Pass it as `template`
instead of `html`/`text`:

```ts
await sendEmail({
  from, to, subject,
  template: { id: "d-abc123", provider: "sendgrid", data: { name: "Dave" } },
});
```

Mailcap has no access to the real template, so its inbox falls back to a
locally-registered preview (or a plain data table if none is registered) —
see the [service's docs](https://github.com/mat-hiretalk/mailcap) for the mock
template registry. Resend has no provider-side template API — a template-only
message on `MAIL_PROVIDER=resend` throws a clear error telling you to render
`html` first (e.g. with React Email) or switch providers for that send.

## Idempotency

Pass `messageId` to dedupe retries — Mailcap only stores the first delivery
for a given id within an environment:

```ts
await sendEmail({ from, to, subject, html, messageId: "signup-verify-42" });
```

## Maintenance note: `dist/` is committed

This package isn't published to npm yet (N7's long-term plan; no npm token
available in this environment). Consumers install it as a git dependency
(`github:Elevora-Tech/mailcap-sdk#<commit>`), which is why `dist/` is checked
into this repo instead of gitignored — a git-sourced install ships repo
content as-is, and there's no install-time build step gating it. **After any
change to `src/`, run `pnpm build` and commit the resulting `dist/` alongside
it**, or consumers pinned to that commit won't see the change.

## License

MIT
