---
"@elevora-tech/mailcap": minor
---

First release under the Elevora Technologies org: package renamed from
`@mat/mailcap` to `@elevora-tech/mailcap` (repo moved to
github.com/Elevora-Tech/mailcap-sdk). Includes everything previously only
available via git pin: provider-client wrap mode (`wrapResendClient`,
`wrapSendGridClient`, `wrapMailgunClient`), the `captureRaw` /
`isMailcapCaptureEnabled` escape hatch, and the `template` message field for
provider-side templates.
