import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMailer,
  MailcapConfigError,
  MailcapRealSendGuardError,
  MailcapIngestError,
} from "../index.js";

function firstCall(mock: ReturnType<typeof vi.fn>): [unknown, RequestInit] {
  const call = mock.mock.calls[0];
  if (!call) throw new Error("expected fetch to have been called");
  return call as [unknown, RequestInit];
}

const baseMessage = {
  from: "app@example.test",
  to: ["user@example.test"],
  subject: "Verify your email",
  html: "<p>Click <a href=\"https://example.test/verify\">here</a></p>",
};

describe("createMailer — capture path", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("F1/F2: POSTs to /api/ingest with a bearer token when a capture key is set", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "email_123" }), { status: 200 }),
    );

    const mailer = createMailer({
      captureApiKey: "mc_test_key",
      captureUrl: "https://mailcap.example.test",
    });
    const result = await mailer.send(baseMessage);

    expect(result).toEqual({ id: "email_123", mode: "captured" });
    const [url, init] = firstCall(fetchMock);
    expect(String(url)).toBe("https://mailcap.example.test/api/ingest");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer mc_test_key");
    expect(JSON.parse(String(init.body)).subject).toBe("Verify your email");
  });

  it("F4: surfaces an error on ingest failure instead of silently dropping", async () => {
    fetchMock.mockResolvedValueOnce(new Response("invalid key", { status: 401 }));

    const mailer = createMailer({
      captureApiKey: "mc_bad_key",
      captureUrl: "https://mailcap.example.test",
    });

    await expect(mailer.send(baseMessage)).rejects.toBeInstanceOf(MailcapIngestError);
  });

  it("F9: capture activates purely from key presence, no mode flag required", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "email_1" }), { status: 200 }),
    );
    const mailer = createMailer({
      captureApiKey: "mc_x",
      captureUrl: "https://mailcap.example.test",
      provider: "resend",
      resendApiKey: "re_should_be_ignored",
    });
    await mailer.send(baseMessage);
    // Only one call: to Mailcap, never to a provider, even though provider config is present.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(firstCall(fetchMock)[0])).toContain("mailcap.example.test");
  });
});

describe("createMailer — real delivery path", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("F31: refuses real delivery outside production without the override", async () => {
    const mailer = createMailer({
      provider: "resend",
      resendApiKey: "re_x",
      nodeEnv: "development",
    });

    await expect(mailer.send(baseMessage)).rejects.toBeInstanceOf(MailcapRealSendGuardError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("F31: allows real delivery outside production when explicitly overridden", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "re_123" }), { status: 200 }),
    );
    const mailer = createMailer({
      provider: "resend",
      resendApiKey: "re_x",
      nodeEnv: "development",
      allowRealSend: true,
    });

    const result = await mailer.send(baseMessage);
    expect(result).toEqual({ id: "re_123", mode: "delivered", provider: "resend" });
  });

  it("delivers via Resend in production with no capture key", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "re_prod_1" }), { status: 200 }),
    );
    const mailer = createMailer({ provider: "resend", resendApiKey: "re_x", nodeEnv: "production" });
    const result = await mailer.send(baseMessage);
    expect(result.mode).toBe("delivered");
    expect(String(firstCall(fetchMock)[0])).toBe("https://api.resend.com/emails");
  });

  it("A11: delivers via SendGrid with zero call-site changes when provider is swapped", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 202, headers: { "x-message-id": "sg_1" } }),
    );
    const mailer = createMailer({
      provider: "sendgrid",
      sendgridApiKey: "sg_x",
      nodeEnv: "production",
    });
    const result = await mailer.send(baseMessage);
    expect(result).toEqual({ id: "sg_1", mode: "delivered", provider: "sendgrid" });
    expect(String(firstCall(fetchMock)[0])).toBe("https://api.sendgrid.com/v3/mail/send");
  });

  it("A11: delivers via Mailgun with zero call-site changes when provider is swapped", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "mg_1" }), { status: 200 }),
    );
    const mailer = createMailer({
      provider: "mailgun",
      mailgunApiKey: "key_x",
      mailgunDomain: "mg.example.test",
      nodeEnv: "production",
    });
    const result = await mailer.send(baseMessage);
    expect(result).toEqual({ id: "mg_1", mode: "delivered", provider: "mailgun" });
    expect(String(firstCall(fetchMock)[0])).toContain("api.mailgun.net");
  });

  it("F30/DV9: throws a clear error naming the missing var when nothing is configured", async () => {
    const mailer = createMailer({ nodeEnv: "production" });
    await expect(mailer.send(baseMessage)).rejects.toBeInstanceOf(MailcapConfigError);
    await expect(mailer.send(baseMessage)).rejects.toThrow(/MAIL_PROVIDER/);
  });

  it("F30/DV9: throws naming the missing key when a provider is set without its key", async () => {
    const mailer = createMailer({ provider: "sendgrid", nodeEnv: "production" });
    await expect(mailer.send(baseMessage)).rejects.toThrow(/SENDGRID_API_KEY/);
  });

  it("F30/DV9: throws naming the missing domain for mailgun without MAILGUN_DOMAIN", async () => {
    const mailer = createMailer({
      provider: "mailgun",
      mailgunApiKey: "key_x",
      nodeEnv: "production",
    });
    await expect(mailer.send(baseMessage)).rejects.toThrow(/MAILGUN_DOMAIN/);
  });
});

describe("createMailer — schema validation", () => {
  it("rejects a message with an invalid recipient address", async () => {
    const mailer = createMailer({
      captureApiKey: "mc_x",
      captureUrl: "https://mailcap.example.test",
    });
    await expect(
      mailer.send({ ...baseMessage, to: ["not-an-email"] }),
    ).rejects.toThrow();
  });

  it("F37a: rejects a message with none of html, text, or template", async () => {
    const mailer = createMailer({
      captureApiKey: "mc_x",
      captureUrl: "https://mailcap.example.test",
    });
    const { html: _html, ...withoutHtml } = baseMessage;
    await expect(mailer.send(withoutHtml)).rejects.toThrow(/html, text, or template/);
  });

  it("F37a: accepts a template-only message (no html/text)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "tpl_1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const mailer = createMailer({
      captureApiKey: "mc_x",
      captureUrl: "https://mailcap.example.test",
    });
    const { html: _html, ...withoutHtml } = baseMessage;
    const result = await mailer.send({
      ...withoutHtml,
      template: { id: "welcome", provider: "mailgun", data: { name: "Dave" } },
    });
    expect(result).toEqual({ id: "tpl_1", mode: "captured" });
    vi.unstubAllGlobals();
  });
});

describe("Resend adapter — provider-side templates", () => {
  it("F37a: throws a clear config error for a template-only send (Resend has no template API)", async () => {
    const mailer = createMailer({
      provider: "resend",
      resendApiKey: "re_x",
      nodeEnv: "production",
    });
    const { html: _html, ...withoutHtml } = baseMessage;
    await expect(
      mailer.send({ ...withoutHtml, template: { id: "welcome", provider: "sendgrid" } }),
    ).rejects.toThrow(MailcapConfigError);
  });
});
