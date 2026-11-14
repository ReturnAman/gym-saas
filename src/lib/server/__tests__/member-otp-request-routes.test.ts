import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route contract for POST /api/member-auth/otp/request, with the facade
 * mocked: the optional `intent` pass-through (exactly "join" reaches
 * the facade; an absent or non-string value arrives as undefined; any
 * other string passes through verbatim for the facade to normalize),
 * and the unchanged response shapes — 200 { challengeId } on success,
 * the 400 validation body, and the 503 provider-outage body. The
 * facade's intent normalization and eligibility behaviour have their
 * own unit and database suites.
 */
const { mockRequestMemberOtp } = vi.hoisted(() => ({
  mockRequestMemberOtp: vi.fn(),
}));

vi.mock("@/lib/server/member-auth", () => ({
  requestMemberOtp: mockRequestMemberOtp,
}));

import { POST as otpRequestPOST } from "@/app/api/member-auth/otp/request/route";
import { MemberValidationError } from "@/lib/members";
import { SmsProviderError } from "@/lib/server/sms-provider";

const ORG_ID = "c3298d3b-a07f-33eb-de2b-00333455cf3f";
const PHONE = "9876543210";
const CHALLENGE_ID = "a12b3c4d-5e6f-47a8-b9c0-0a1b2c3d4e5f";

function jsonRequest(body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Request("https://gym.example.com/api/member-auth/otp/request", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "gym.example.com",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

function lastFacadeInput(): Record<string, unknown> {
  expect(mockRequestMemberOtp).toHaveBeenCalledTimes(1);
  return mockRequestMemberOtp.mock.calls[0]![0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequestMemberOtp.mockResolvedValue({ challengeId: CHALLENGE_ID });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/member-auth/otp/request — intent pass-through", () => {
  it("passes intent 'join' through to the facade", async () => {
    const response = await otpRequestPOST(
      jsonRequest({ organizationId: ORG_ID, phoneNumber: PHONE, intent: "join" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ challengeId: CHALLENGE_ID });
    expect(lastFacadeInput()).toEqual({
      organizationId: ORG_ID,
      phoneNumber: PHONE,
      intent: "join",
      // No forwarded header and no hash secret configured in this
      // suite: the request carries no IP bucket key (Phase M3a).
      ipKeyHash: null,
    });
  });

  it("passes an HMAC bucket key — never the raw IP — when a trusted forwarded address and secret exist", async () => {
    vi.stubEnv("RATE_LIMIT_HASH_SECRET", "route-test-rate-secret-0123456789ab");
    const response = await otpRequestPOST(
      jsonRequest(
        { organizationId: ORG_ID, phoneNumber: PHONE },
        { "x-forwarded-for": "spoofed.example, 203.0.113.7" },
      ),
    );
    expect(response.status).toBe(200);
    const input = lastFacadeInput();
    expect(input.ipKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(String(input.ipKeyHash)).not.toContain("203.0.113.7");
  });

  it("sends intent as undefined when the body omits it", async () => {
    const response = await otpRequestPOST(
      jsonRequest({ organizationId: ORG_ID, phoneNumber: PHONE }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ challengeId: CHALLENGE_ID });
    const input = lastFacadeInput();
    expect(input.organizationId).toBe(ORG_ID);
    expect(input.phoneNumber).toBe(PHONE);
    expect(input.intent).toBeUndefined();
  });

  it("passes an unrecognized string intent through verbatim (the facade normalizes it)", async () => {
    const response = await otpRequestPOST(
      jsonRequest({ organizationId: ORG_ID, phoneNumber: PHONE, intent: "banana" }),
    );
    expect(response.status).toBe(200);
    expect(lastFacadeInput().intent).toBe("banana");
  });

  it("sends intent as undefined for a non-string intent value", async () => {
    const response = await otpRequestPOST(
      jsonRequest({ organizationId: ORG_ID, phoneNumber: PHONE, intent: 42 }),
    );
    expect(response.status).toBe(200);
    expect(lastFacadeInput().intent).toBeUndefined();
  });
});

describe("POST /api/member-auth/otp/request — unchanged response shapes", () => {
  it("returns the 400 validation body when the facade rejects the phone shape", async () => {
    mockRequestMemberOtp.mockRejectedValue(
      new MemberValidationError({ phoneNumber: "Phone number must be exactly 10 digits." }),
    );
    const response = await otpRequestPOST(
      jsonRequest({ organizationId: ORG_ID, phoneNumber: "123", intent: "join" }),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 503 OTP_UNAVAILABLE when the provider fails, on either intent", async () => {
    mockRequestMemberOtp.mockRejectedValue(
      new SmsProviderError("PROVIDER_UNAVAILABLE"),
    );
    for (const intent of [undefined, "join"]) {
      mockRequestMemberOtp.mockClear();
      mockRequestMemberOtp.mockRejectedValue(
        new SmsProviderError("PROVIDER_UNAVAILABLE"),
      );
      const response = await otpRequestPOST(
        jsonRequest({ organizationId: ORG_ID, phoneNumber: PHONE, intent }),
      );
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.error.code).toBe("OTP_UNAVAILABLE");
    }
  });

  it("returns the 400 validation body for a malformed body without calling the facade", async () => {
    const missing = await otpRequestPOST(jsonRequest({ organizationId: ORG_ID }));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.code).toBe("VALIDATION_ERROR");

    const notJson = await otpRequestPOST(
      new Request("https://gym.example.com/api/member-auth/otp/request", {
        method: "POST",
        headers: { "content-type": "application/json", host: "gym.example.com" },
        body: "not json",
      }),
    );
    expect(notJson.status).toBe(400);
    expect((await notJson.json()).error.code).toBe("VALIDATION_ERROR");
    expect(mockRequestMemberOtp).not.toHaveBeenCalled();
  });
});
