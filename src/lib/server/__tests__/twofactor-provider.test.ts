import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SmsProviderError } from "@/lib/server/sms-provider";
import { twoFactorProvider } from "@/lib/server/twofactor-provider";

/**
 * 2Factor provider: tested with a mocked global fetch — no network, no
 * real API key. The key used here is a fixture string; several tests assert
 * it never leaks into thrown errors (2Factor embeds the key in its URLs,
 * so any error carrying a URL or upstream body would expose it).
 */
const TEST_KEY = "test-api-key-000111222";

const mockFetch = vi.fn();

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TWOFACTOR_API_KEY", TEST_KEY);
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("twoFactorProvider.sendOtp (AUTOGEN)", () => {
  it("maps the AUTOGEN Details session id to providerSessionId", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ Status: "Success", Details: "session-abc-123" }),
    );
    const result = await twoFactorProvider.sendOtp("9876543210");
    expect(result).toEqual({ providerSessionId: "session-abc-123" });
  });

  it("converts the canonical 10-digit number to the +91 provider form", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ Status: "Success", Details: "session-abc-123" }),
    );
    await twoFactorProvider.sendOtp("9876543210");
    const url = String(mockFetch.mock.calls[0]?.[0]);
    expect(url).toContain(encodeURIComponent("+919876543210"));
    expect(url).toContain("/AUTOGEN");
    expect(url).toContain(TEST_KEY);
  });

  it("rejects with PROVIDER_REJECTED when AUTOGEN reports an error status", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ Status: "Error", Details: "Invalid number" }),
    );
    const error = await twoFactorProvider
      .sendOtp("9876543210")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SmsProviderError);
    expect((error as SmsProviderError).code).toBe("PROVIDER_REJECTED");
  });
});

describe("twoFactorProvider.verifyOtp (VERIFY)", () => {
  it("returns verified=true when the provider confirms the OTP", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ Status: "Success", Details: "OTP Matched" }),
    );
    const result = await twoFactorProvider.verifyOtp("session-abc-123", "123456");
    expect(result).toEqual({ verified: true });
    const url = String(mockFetch.mock.calls[0]?.[0]);
    expect(url).toContain("/SMS/VERIFY/session-abc-123/123456");
  });

  it("returns verified=false for a mismatched OTP (not an error)", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ Status: "Error", Details: "OTP Mismatched" }),
    );
    const result = await twoFactorProvider.verifyOtp("session-abc-123", "000000");
    expect(result).toEqual({ verified: false });
  });
});

describe("twoFactorProvider failure handling", () => {
  it("normalizes a non-200 upstream response without leaking key or URL", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, false, 500));
    const error = await twoFactorProvider
      .sendOtp("9876543210")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SmsProviderError);
    expect((error as SmsProviderError).code).toBe("PROVIDER_UNAVAILABLE");
    expect((error as Error).message).not.toContain(TEST_KEY);
    expect((error as Error).message).not.toContain("2factor");
  });

  it("normalizes a network failure without leaking key or URL", async () => {
    // Simulate the kind of raw fetch error that embeds the request URL.
    mockFetch.mockRejectedValue(
      new Error(`fetch failed: https://2factor.in/API/V1/${TEST_KEY}/SMS/...`),
    );
    const error = await twoFactorProvider
      .verifyOtp("session-abc-123", "123456")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SmsProviderError);
    expect((error as SmsProviderError).code).toBe("PROVIDER_UNAVAILABLE");
    expect((error as Error).message).not.toContain(TEST_KEY);
    expect((error as Error).message).not.toContain("2factor");
  });

  it("fails with NOT_CONFIGURED and makes no call when the API key is missing", async () => {
    vi.stubEnv("TWOFACTOR_API_KEY", "");
    const error = await twoFactorProvider
      .sendOtp("9876543210")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SmsProviderError);
    expect((error as SmsProviderError).code).toBe("NOT_CONFIGURED");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
