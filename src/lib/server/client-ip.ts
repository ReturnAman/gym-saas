import "server-only";

import { createHmac } from "node:crypto";
import { isIP } from "node:net";

import { readRateLimitIpMode } from "./rate-limit";
import { SmsProviderError } from "./sms-provider";

/**
 * Client IP identification and hashing for rate limiting (Phase M3a).
 *
 * TRUST MODEL — read before changing. The production deployment runs
 * behind exactly ONE trusted proxy: the Railway platform edge, which
 * forwards requests to the application and appends the client address
 * it observed as the FINAL entry of `x-forwarded-for`. Therefore:
 *
 * - Only the LAST entry of `x-forwarded-for` is trusted. Every earlier
 *   entry is client-controlled (a client can send any XFF header it
 *   likes; the platform proxy passes it through and appends the real
 *   observed address after it), so earlier entries are never used.
 * - If a second proxy or CDN is ever placed in front of Railway, this
 *   assumption must be revisited — the trusted hop is "the platform
 *   that terminates at the application", not a fixed position count.
 * - `x-real-ip` and similar headers are not used: the platform does
 *   not set them, so they would be pure client input.
 *
 * SAFE FALLBACKS. A missing header, an empty chain, or a malformed
 * final hop yields NO key (null) — the request then simply has no IP
 * dimension. It is never mapped to a shared bucket key (an empty-string
 * bucket would rate-limit every unidentifiable user together), and a
 * missing key never blocks: on the platform path the header is set by
 * the proxy, so absence means local development or a topology change
 * to investigate — not a per-request punishment.
 *
 * PRIVACY. Raw IPs are never logged and never persisted. Bucket keys
 * are HMAC-SHA256 hashes under a dedicated secret
 * (RATE_LIMIT_HASH_SECRET), so stored keys cannot be reversed into
 * addresses or correlated with other systems.
 */

/** Minimum secret material, in bytes, for the IP hash key. */
export const RATE_LIMIT_HASH_SECRET_MIN_BYTES = 32;

/**
 * Read and validate the IP hash secret. Throws
 * SmsProviderError("NOT_CONFIGURED") when absent or short — the same
 * normalized configuration failure the OTP paths already surface.
 */
export function readRateLimitHashSecret(): string {
  const secret = process.env.RATE_LIMIT_HASH_SECRET;
  if (
    !secret ||
    Buffer.byteLength(secret, "utf8") < RATE_LIMIT_HASH_SECRET_MIN_BYTES
  ) {
    throw new SmsProviderError("NOT_CONFIGURED");
  }
  return secret;
}

/**
 * Extract the trusted client IP from a request, or null when no
 * trustworthy value exists (missing/malformed header). Only the final
 * `x-forwarded-for` hop is considered (see the trust model above), and
 * only literal IPv4/IPv6 addresses are accepted.
 */
export function extractClientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) {
    return null;
  }
  const hops = forwarded
    .split(",")
    .map((hop) => hop.trim())
    .filter((hop) => hop.length > 0);
  if (hops.length === 0) {
    return null;
  }
  const observed = hops[hops.length - 1]!;
  return isIP(observed) ? observed : null;
}

/** Keyed, non-reversible bucket key for one IP address. */
export function hashClientIp(secret: string, ip: string): string {
  return createHmac("sha256", secret)
    .update(`rate-limit-ip:${ip}`, "utf8")
    .digest("hex");
}

/**
 * Resolve the rate-limit bucket key for a request, honoring the mode:
 *
 * - "off": always null (no counting; the secret is never read).
 * - "shadow": the key when an IP and a valid secret are available;
 *   otherwise null — shadow observation degrades silently if the
 *   secret is not configured yet, it never fails a request.
 * - "enforce": the key when an IP is available; a missing/invalid
 *   secret FAILS CLOSED with NOT_CONFIGURED (enforcement was
 *   explicitly requested, so silently skipping it would be worse than
 *   a visible 503). A missing IP still yields null (see fallbacks).
 */
export function clientIpKeyHashForRequest(request: Request): string | null {
  const mode = readRateLimitIpMode();
  if (mode === "off") {
    return null;
  }
  const ip = extractClientIp(request);
  if (!ip) {
    return null;
  }
  if (mode === "shadow") {
    try {
      return hashClientIp(readRateLimitHashSecret(), ip);
    } catch {
      return null;
    }
  }
  return hashClientIp(readRateLimitHashSecret(), ip);
}
