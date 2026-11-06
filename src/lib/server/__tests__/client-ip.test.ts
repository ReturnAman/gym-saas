import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clientIpKeyHashForRequest,
  extractClientIp,
  hashClientIp,
  readRateLimitHashSecret,
} from "@/lib/server/client-ip";
import { SmsProviderError } from "@/lib/server/sms-provider";

/**
 * Client-IP trust and hashing. The deployment sits behind ONE trusted
 * platform proxy (Railway), which appends the observed client address
 * as the FINAL x-forwarded-for entry — so only that entry is trusted
 * and every earlier (client-controlled) entry is ignored.
 */
const SECRET = "test-rate-limit-secret-0123456789abcd"; // 37 bytes

function requestWithForwardedFor(value?: string): Request {
  return new Request("https://example.test/api/member-auth/otp/request", {
    headers: value === undefined ? {} : { "x-forwarded-for": value },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("extractClientIp", () => {
  it("returns a single forwarded address", () => {
    expect(extractClientIp(requestWithForwardedFor("203.0.113.7"))).toBe("203.0.113.7");
  });

  it("trusts only the final hop, ignoring client-supplied earlier entries", () => {
    expect(extractClientIp(requestWithForwardedFor("1.2.3.4, 203.0.113.7"))).toBe(
      "203.0.113.7",
    );
    // Spoofing attempt: attacker-chosen addresses in front change nothing.
    expect(
      extractClientIp(requestWithForwardedFor("9.9.9.9, 8.8.8.8, 203.0.113.7")),
    ).toBe("203.0.113.7");
  });

  it("accepts IPv6 literals", () => {
    expect(extractClientIp(requestWithForwardedFor("2001:db8::1"))).toBe("2001:db8::1");
  });

  it("returns null for missing, empty, or malformed values — never a shared fallback", () => {
    expect(extractClientIp(requestWithForwardedFor(undefined))).toBeNull();
    expect(extractClientIp(requestWithForwardedFor(""))).toBeNull();
    expect(extractClientIp(requestWithForwardedFor("  ,  "))).toBeNull();
    expect(extractClientIp(requestWithForwardedFor("unknown"))).toBeNull();
    // A valid early hop does not rescue a malformed final hop.
    expect(extractClientIp(requestWithForwardedFor("203.0.113.7, garbage"))).toBeNull();
    expect(extractClientIp(requestWithForwardedFor("203.0.113.999"))).toBeNull();
  });
});

describe("hashClientIp", () => {
  it("is deterministic, keyed, and non-reversible in shape", () => {
    const hash = hashClientIp(SECRET, "203.0.113.7");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashClientIp(SECRET, "203.0.113.7")).toBe(hash);
    expect(hash).not.toContain("203.0.113.7");
    expect(hashClientIp(SECRET, "203.0.113.8")).not.toBe(hash);
    expect(hashClientIp("another-secret-key-0123456789abcdef0", "203.0.113.7")).not.toBe(hash);
  });
});

describe("readRateLimitHashSecret", () => {
  it("fails closed below 32 bytes or when missing", () => {
    vi.stubEnv("RATE_LIMIT_HASH_SECRET", "");
    expect(() => readRateLimitHashSecret()).toThrowError(SmsProviderError);
    vi.stubEnv("RATE_LIMIT_HASH_SECRET", "a".repeat(31));
    const error = (() => {
      try {
        readRateLimitHashSecret();
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect((error as SmsProviderError).code).toBe("NOT_CONFIGURED");
    vi.stubEnv("RATE_LIMIT_HASH_SECRET", SECRET);
    expect(readRateLimitHashSecret()).toBe(SECRET);
  });
});

describe("clientIpKeyHashForRequest", () => {
  it("off mode: never produces a key and never reads the secret", () => {
    vi.stubEnv("RATE_LIMIT_IP_MODE", "off");
    vi.stubEnv("RATE_LIMIT_HASH_SECRET", "");
    expect(clientIpKeyHashForRequest(requestWithForwardedFor("203.0.113.7"))).toBeNull();
  });

  it("shadow mode: hashes when configured, degrades to null when the secret is missing", () => {
    vi.stubEnv("RATE_LIMIT_IP_MODE", "shadow");
    vi.stubEnv("RATE_LIMIT_HASH_SECRET", SECRET);
    expect(clientIpKeyHashForRequest(requestWithForwardedFor("203.0.113.7"))).toBe(
      hashClientIp(SECRET, "203.0.113.7"),
    );
    vi.stubEnv("RATE_LIMIT_HASH_SECRET", "");
    expect(clientIpKeyHashForRequest(requestWithForwardedFor("203.0.113.7"))).toBeNull();
  });

  it("enforce mode: fails closed when the secret is missing", () => {
    vi.stubEnv("RATE_LIMIT_IP_MODE", "enforce");
    vi.stubEnv("RATE_LIMIT_HASH_SECRET", "");
    const error = (() => {
      try {
        clientIpKeyHashForRequest(requestWithForwardedFor("203.0.113.7"));
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(SmsProviderError);
    expect((error as SmsProviderError).code).toBe("NOT_CONFIGURED");
  });

  it("a request without a trustworthy IP has no key in every mode (never blocked for it)", () => {
    vi.stubEnv("RATE_LIMIT_HASH_SECRET", SECRET);
    for (const mode of ["shadow", "enforce"]) {
      vi.stubEnv("RATE_LIMIT_IP_MODE", mode);
      expect(clientIpKeyHashForRequest(requestWithForwardedFor(undefined))).toBeNull();
      expect(clientIpKeyHashForRequest(requestWithForwardedFor("spoofed, garbage"))).toBeNull();
    }
  });
});
