import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiTxtProvider } from "@/lib/server/apitxt-provider";
import { SmsProviderError } from "@/lib/server/sms-provider";

/**
 * APITxT delivery provider: tested with a mocked global fetch — no
 * network, no real API key, no real SMS (the owner's balance is never
 * touched). The key and OTP used here are fixture strings; several
 * tests assert they never leak into thrown errors or the request URL.
 */
const TEST_KEY = "test-apitxt-key-000111222";
const TEST_OTP = "654321";
const PHONE = "9876543210";

const mockFetch = vi.fn();

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

function successResponse() {
  return jsonResponse({
    status: "success",
    message: "OTP sent successfully",
    data: { request_id: "req-fixture-1", mobile: "919876543210", cost: 0.25 },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APITXT_API_KEY", TEST_KEY);
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function requestParts(): { url: string; init: RequestInit; body: URLSearchParams } {
  const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
  return { url, init, body: init.body as URLSearchParams };
}

describe("apiTxtProvider.sendOtp", () => {
  it("POSTs to the exact documented endpoint with a form-urlencoded body", async () => {
    mockFetch.mockResolvedValue(successResponse());
    await apiTxtProvider.sendOtp(PHONE, TEST_OTP);

    const { url, init, body } = requestParts();
    expect(url).toBe("https://apitxt.com/api/sendOTP");
    expect(init.method).toBe("POST");
    // A URLSearchParams body is what makes fetch send
    // application/x-www-form-urlencoded.
    expect(body).toBeInstanceOf(URLSearchParams);
    expect(body.get("authkey")).toBe(TEST_KEY);
    expect(body.get("mobile")).toBe("919876543210");
    expect(body.get("otp")).toBe(TEST_OTP);
    expect(body.get("channel")).toBe("sms");
    expect(body.get("country")).toBe("91");
  });

  it("omits template_id and template_name (account default route)", async () => {
    mockFetch.mockResolvedValue(successResponse());
    await apiTxtProvider.sendOtp(PHONE, TEST_OTP);
    const { body } = requestParts();
    expect(body.has("template_id")).toBe(false);
    expect(body.has("template_name")).toBe(false);
  });

  it("keeps the API key and OTP out of the request URL", async () => {
    mockFetch.mockResolvedValue(successResponse());
    await apiTxtProvider.sendOtp(PHONE, TEST_OTP);
    const { url } = requestParts();
    expect(url).not.toContain(TEST_KEY);
    expect(url).not.toContain(TEST_OTP);
  });

  it("resolves on the documented success response", async () => {
    mockFetch.mockResolvedValue(successResponse());
    await expect(apiTxtProvider.sendOtp(PHONE, TEST_OTP)).resolves.toBeUndefined();
  });

  it("rejects with PROVIDER_REJECTED on a non-success provider response", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ status: "error", message: "fixture failure detail" }),
    );
    const error = await apiTxtProvider
      .sendOtp(PHONE, TEST_OTP)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SmsProviderError);
    expect((error as SmsProviderError).code).toBe("PROVIDER_REJECTED");
    // Upstream payloads never surface.
    expect((error as Error).message).not.toContain("fixture failure detail");
    expect((error as Error).message).not.toContain(TEST_KEY);
    expect((error as Error).message).not.toContain(TEST_OTP);
  });
});

describe("apiTxtProvider failure handling", () => {
  it("normalizes an HTTP failure without leaking key, OTP, or URL", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, false, 500));
    const error = await apiTxtProvider
      .sendOtp(PHONE, TEST_OTP)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SmsProviderError);
    expect((error as SmsProviderError).code).toBe("PROVIDER_UNAVAILABLE");
    expect((error as Error).message).not.toContain(TEST_KEY);
    expect((error as Error).message).not.toContain(TEST_OTP);
    expect((error as Error).message).not.toContain("apitxt.com");
  });

  it("normalizes invalid JSON as unavailable", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("fixture: not json");
      },
    });
    const error = await apiTxtProvider
      .sendOtp(PHONE, TEST_OTP)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SmsProviderError);
    expect((error as SmsProviderError).code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("normalizes a network/timeout failure without leaking request details", async () => {
    mockFetch.mockRejectedValue(
      new Error(`fetch failed for ${TEST_KEY} with code ${TEST_OTP}`),
    );
    const error = await apiTxtProvider
      .sendOtp(PHONE, TEST_OTP)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SmsProviderError);
    expect((error as SmsProviderError).code).toBe("PROVIDER_UNAVAILABLE");
    expect((error as Error).message).not.toContain(TEST_KEY);
    expect((error as Error).message).not.toContain(TEST_OTP);
  });

  it("fails with NOT_CONFIGURED and makes no call when the API key is missing", async () => {
    vi.stubEnv("APITXT_API_KEY", "");
    const error = await apiTxtProvider
      .sendOtp(PHONE, TEST_OTP)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SmsProviderError);
    expect((error as SmsProviderError).code).toBe("NOT_CONFIGURED");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
