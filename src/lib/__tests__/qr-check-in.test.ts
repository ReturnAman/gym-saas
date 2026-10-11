import { describe, expect, it } from "vitest";

import { parseScannedCheckInUrl } from "@/lib/qr-check-in";

/**
 * Scanned-QR acceptance rules (in-app scanner). A QR code is untrusted
 * physical-world input: only the exact URL shape the gym's own poster
 * encodes — this application's origin, the check-in route, a gym
 * identifier — is accepted, and only the identifier is ever extracted.
 * The scanned string itself is never a navigation target.
 */
const ORIGIN = "https://gym.example.com";
const VALID = "https://gym.example.com/member/check-in?gym=org-123";

describe("parseScannedCheckInUrl", () => {
  it("accepts the poster's exact URL shape and extracts the gym", () => {
    expect(parseScannedCheckInUrl(VALID, ORIGIN)).toEqual({ gym: "org-123" });
  });

  it("tolerates surrounding whitespace from the decoder", () => {
    expect(parseScannedCheckInUrl(`  ${VALID}\n`, ORIGIN)).toEqual({
      gym: "org-123",
    });
  });

  it("accepts extra query parameters and extracts the gym exactly", () => {
    expect(
      parseScannedCheckInUrl(
        "https://gym.example.com/member/check-in?src=poster&gym=org-9&lang=en",
        ORIGIN,
      ),
    ).toEqual({ gym: "org-9" });
  });

  it("rejects a trailing-slash path", () => {
    expect(
      parseScannedCheckInUrl(
        "https://gym.example.com/member/check-in/?gym=org-123",
        ORIGIN,
      ),
    ).toBeNull();
  });

  it("rejects a different origin", () => {
    expect(
      parseScannedCheckInUrl(
        "https://other.example.com/member/check-in?gym=org-123",
        ORIGIN,
      ),
    ).toBeNull();
  });

  it("rejects subdomains and look-alike hosts", () => {
    expect(
      parseScannedCheckInUrl(
        "https://evil.gym.example.com/member/check-in?gym=org-123",
        ORIGIN,
      ),
    ).toBeNull();
    expect(
      parseScannedCheckInUrl(
        "https://gym.example.com.evil.com/member/check-in?gym=org-123",
        ORIGIN,
      ),
    ).toBeNull();
  });

  it("rejects a different port on the same host", () => {
    expect(
      parseScannedCheckInUrl(
        "https://gym.example.com:8443/member/check-in?gym=org-123",
        ORIGIN,
      ),
    ).toBeNull();
  });

  it("rejects an http scan against an https origin (and vice versa)", () => {
    expect(
      parseScannedCheckInUrl(
        "http://gym.example.com/member/check-in?gym=org-123",
        ORIGIN,
      ),
    ).toBeNull();
    expect(
      parseScannedCheckInUrl(VALID, "http://gym.example.com"),
    ).toBeNull();
  });

  it("rejects non-check-in paths on the right origin", () => {
    expect(
      parseScannedCheckInUrl("https://gym.example.com/member?gym=org-123", ORIGIN),
    ).toBeNull();
    expect(
      parseScannedCheckInUrl(
        "https://gym.example.com/app/org/attendance?gym=org-123",
        ORIGIN,
      ),
    ).toBeNull();
  });

  it("rejects a missing or empty gym parameter", () => {
    expect(
      parseScannedCheckInUrl("https://gym.example.com/member/check-in", ORIGIN),
    ).toBeNull();
    expect(
      parseScannedCheckInUrl(
        "https://gym.example.com/member/check-in?gym=",
        ORIGIN,
      ),
    ).toBeNull();
  });

  it("rejects plain text that is not a URL", () => {
    expect(parseScannedCheckInUrl("org-123", ORIGIN)).toBeNull();
    expect(parseScannedCheckInUrl("check in at the front desk", ORIGIN)).toBeNull();
    expect(parseScannedCheckInUrl("", ORIGIN)).toBeNull();
  });

  it("rejects non-http(s) schemes", () => {
    expect(parseScannedCheckInUrl("javascript:alert(1)", ORIGIN)).toBeNull();
    expect(
      parseScannedCheckInUrl(
        "intent://gym.example.com/member/check-in?gym=org-123",
        ORIGIN,
      ),
    ).toBeNull();
  });
});
