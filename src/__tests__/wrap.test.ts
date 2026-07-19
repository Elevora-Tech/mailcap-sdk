import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureRaw,
  isMailcapCaptureEnabled,
  wrapMailgunClient,
  wrapResendClient,
  wrapSendGridClient,
} from "../wrap.js";
import { MailcapRealSendGuardError } from "../errors.js";

const captureConfig = {
  captureApiKey: "mc_test_key",
  captureUrl: "https://mailcap.example.test",
};

describe("isMailcapCaptureEnabled", () => {
  it("is true when a capture key is configured", () => {
    expect(isMailcapCaptureEnabled(captureConfig)).toBe(true);
  });

  it("is false when no capture key is configured", () => {
    expect(isMailcapCaptureEnabled({ captureApiKey: undefined })).toBe(false);
  });
});

describe("captureRaw", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("F36b: POSTs a hand-built message straight to ingest", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "raw_1" }), { status: 200 }),
    );
    const result = await captureRaw(
      { from: "a@test.dev", to: ["b@test.dev"], subject: "hi", text: "hello" },
      captureConfig,
    );
    expect(result).toEqual({ id: "raw_1" });
  });
});

describe("wrapMailgunClient", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("DV12/A13: captures a Thriveworks-shaped messages.create() call unchanged", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "mg_captured_1" }), { status: 200 }),
    );
    const realClient = { messages: { create: vi.fn() } };
    const wrapped = wrapMailgunClient(realClient, captureConfig);

    const result = await wrapped.messages.create("mg.example.test", {
      from: "noreply@thriveworks.test",
      to: "patient@thriveworks.test",
      subject: "Your login code",
      template: "login_otp_template",
      "t:variables": JSON.stringify({ otp: "482913" }),
    });

    expect(result).toEqual({ id: "mg_captured_1", message: "Queued. Thank you." });
    expect(realClient.messages.create).not.toHaveBeenCalled();

    const [, init] = fetchMock.mock.calls[0] as [unknown, RequestInit];
    const sent = JSON.parse(String(init.body));
    expect(sent.template).toEqual({
      id: "login_otp_template",
      provider: "mailgun",
      data: { otp: "482913" },
    });
  });

  it("passes through to the real client when not capturing, with the F31 guard applied", async () => {
    const realClient = { messages: { create: vi.fn().mockResolvedValue({ id: "real_1" }) } };
    const wrapped = wrapMailgunClient(realClient, {
      captureApiKey: undefined,
      nodeEnv: "development",
    });

    await expect(
      wrapped.messages.create("mg.example.test", { from: "a@test.dev", to: "b@test.dev" }),
    ).rejects.toBeInstanceOf(MailcapRealSendGuardError);
    expect(realClient.messages.create).not.toHaveBeenCalled();
  });

  it("passes through unchanged in production", async () => {
    const realClient = { messages: { create: vi.fn().mockResolvedValue({ id: "real_2" }) } };
    const wrapped = wrapMailgunClient(realClient, {
      captureApiKey: undefined,
      nodeEnv: "production",
    });

    const payload = { from: "a@test.dev", to: "b@test.dev", subject: "x" };
    const result = await wrapped.messages.create("mg.example.test", payload);
    expect(result).toEqual({ id: "real_2" });
    expect(realClient.messages.create).toHaveBeenCalledWith("mg.example.test", payload);
  });
});

describe("wrapSendGridClient", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("captures a @sendgrid/mail-shaped send() call unchanged", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "sg_captured_1" }), { status: 200 }),
    );
    const realClient = { send: vi.fn() };
    const wrapped = wrapSendGridClient(realClient, captureConfig);

    const result = await wrapped.send({
      to: "user@test.dev",
      from: "noreply@test.dev",
      subject: "Welcome",
      templateId: "d-abc123",
      dynamicTemplateData: { name: "Dave" },
    });

    expect(Array.isArray(result)).toBe(true);
    expect(realClient.send).not.toHaveBeenCalled();

    const [, init] = fetchMock.mock.calls[0] as [unknown, RequestInit];
    const sent = JSON.parse(String(init.body));
    expect(sent.template).toEqual({ id: "d-abc123", provider: "sendgrid", data: { name: "Dave" } });
  });

  it("passes through to the real client in production", async () => {
    const realClient = { send: vi.fn().mockResolvedValue([{ statusCode: 202 }, {}]) };
    const wrapped = wrapSendGridClient(realClient, {
      captureApiKey: undefined,
      nodeEnv: "production",
    });
    const payload = { to: "a@test.dev", from: "b@test.dev", subject: "x", text: "y" };
    await wrapped.send(payload);
    expect(realClient.send).toHaveBeenCalledWith(payload);
  });
});

describe("wrapResendClient", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("captures a resend-shaped emails.send() call unchanged", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "re_captured_1" }), { status: 200 }),
    );
    const realClient = { emails: { send: vi.fn() } };
    const wrapped = wrapResendClient(realClient, captureConfig);

    const result = await wrapped.emails.send({
      from: "noreply@test.dev",
      to: "user@test.dev",
      subject: "Hi",
      html: "<p>hi</p>",
    });

    expect(result).toEqual({ data: { id: "re_captured_1" }, error: null });
    expect(realClient.emails.send).not.toHaveBeenCalled();
  });

  it("passes through to the real client in production", async () => {
    const realClient = { emails: { send: vi.fn().mockResolvedValue({ data: { id: "re_2" } }) } };
    const wrapped = wrapResendClient(realClient, {
      captureApiKey: undefined,
      nodeEnv: "production",
    });
    const payload = { from: "a@test.dev", to: "b@test.dev", subject: "x", html: "<p>y</p>" };
    await wrapped.emails.send(payload);
    expect(realClient.emails.send).toHaveBeenCalledWith(payload);
  });
});
