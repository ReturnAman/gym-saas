import { afterEach, describe, expect, it, vi } from "vitest";

import {
  computeOtpHash,
  generateOtpCode,
  otpHashMatches,
  readOtpHmacSecret,
} from "@/lib/server/otp-crypto";
import { SmsProviderError } from "@/lib/server/sms-provider";

/**
 * OTP crypto primitives: secure generation (including leading zeros),
 * secret validation, digest binding, and constant-time comparison.
 * All secrets here are fixtures.
 */
const SECRET = "test-otp-hmac-secret-0123456789abcdef"; // 37 bytes
const OTHER_SECRET = "other-otp-hmac-secret-0123456789abcde"; // 37 bytes

const ORG_ID = "c3298d3b-a07f-33eb-de2b-00333455cf3f";
const OTHER_ORG_ID = "d4399d4c-b180-44fc-ef3c-11444566e5a0";
const CHALLENGE_ID = "a12b3c4d-5e6f-47a8-b9c0-0a1b2c3d4e5f";
const PHONE = "9876543210";

const BINDING = {
  organizationId: ORG_ID,
  challengeId: CHALLENGE_ID,
  phoneNumber: PHONE,
  otp: "123456",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("generateOtpCode", () => {
  it("zero-pads so leading-zero codes occur", () => {
    expect(generateOtpCode(() => 7)).toBe("000007");
    expect(generateOtpCode(() => 0)).toBe("000000");
    expect(generateOtpCode(() => 42)).toBe("000042");
  });

  it("covers the full six-digit range", () => {
    expect(generateOtpCode(() => 999_999)).toBe("999999");
    expect(generateOtpCode(() => 123_456)).toBe("123456");
  });

  it("produces exactly six digits from the secure default source", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateOtpCode()).toMatch(/^[0-9]{6}$/);
    }
  });
});

describe("readOtpHmacSecret", () => {
  it("returns a secret with at least 32 bytes of material", () => {
    vi.stubEnv("MEMBER_OTP_HMAC_SECRET", SECRET);
    expect(readOtpHmacSecret()).toBe(SECRET);
    vi.stubEnv("MEMBER_OTP_HMAC_SECRET", "a".repeat(32));
    expect(readOtpHmacSecret()).toBe("a".repeat(32));
  });

  it("measures bytes, not characters", () => {
    // 16 two-byte characters = 32 bytes of material.
    vi.stubEnv("MEMBER_OTP_HMAC_SECRET", "é".repeat(16));
    expect(readOtpHmacSecret()).toBe("é".repeat(16));
  });

  it("fails closed when the secret is missing or short", () => {
    vi.stubEnv("MEMBER_OTP_HMAC_SECRET", "");
    expect(() => readOtpHmacSecret()).toThrowError(SmsProviderError);
    vi.stubEnv("MEMBER_OTP_HMAC_SECRET", "a".repeat(31));
    const error = (() => {
      try {
        readOtpHmacSecret();
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(SmsProviderError);
    expect((error as SmsProviderError).code).toBe("NOT_CONFIGURED");
  });
});

describe("computeOtpHash / otpHashMatches", () => {
  it("produces a deterministic 64-char hex digest", () => {
    const hash = computeOtpHash(SECRET, BINDING);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(computeOtpHash(SECRET, BINDING)).toBe(hash);
  });

  it("binds the digest to organization, challenge, phone, OTP, and secret", () => {
    const hash = computeOtpHash(SECRET, BINDING);
    expect(computeOtpHash(SECRET, { ...BINDING, organizationId: OTHER_ORG_ID })).not.toBe(hash);
    expect(computeOtpHash(SECRET, { ...BINDING, challengeId: "b22c4d5e-6f70-48b9-d1e2-3f4a5b6c7d8e" })).not.toBe(hash);
    expect(computeOtpHash(SECRET, { ...BINDING, phoneNumber: "9123456780" })).not.toBe(hash);
    expect(computeOtpHash(SECRET, { ...BINDING, otp: "123457" })).not.toBe(hash);
    expect(computeOtpHash(OTHER_SECRET, BINDING)).not.toBe(hash);
  });

  it("matches the correct OTP and rejects a wrong one", () => {
    const stored = computeOtpHash(SECRET, BINDING);
    expect(otpHashMatches(SECRET, BINDING, stored)).toBe(true);
    expect(otpHashMatches(SECRET, { ...BINDING, otp: "000000" }, stored)).toBe(false);
  });

  it("rejects a digest replayed under another tenant's binding", () => {
    const stored = computeOtpHash(SECRET, BINDING);
    expect(
      otpHashMatches(SECRET, { ...BINDING, organizationId: OTHER_ORG_ID }, stored),
    ).toBe(false);
  });

  it("never matches a missing or malformed stored digest", () => {
    expect(otpHashMatches(SECRET, BINDING, null)).toBe(false);
    expect(otpHashMatches(SECRET, BINDING, undefined)).toBe(false);
    expect(otpHashMatches(SECRET, BINDING, "")).toBe(false);
    expect(otpHashMatches(SECRET, BINDING, "not-a-hash")).toBe(false);
    // Wrong length, and uppercase (digests are stored lowercase hex).
    expect(otpHashMatches(SECRET, BINDING, "a".repeat(63))).toBe(false);
    expect(otpHashMatches(SECRET, BINDING, computeOtpHash(SECRET, BINDING).toUpperCase())).toBe(false);
  });
});
