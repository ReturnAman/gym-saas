import { describe, expect, it } from "vitest";

import {
  canonicalizePhoneNumber,
  canonicalizePhoneNumbers,
  findMatchingVerifiedPhone,
  maskPhoneNumber,
  parseIndianMobileInput,
} from "../saas-phone";

/**
 * Canonical verified-phone handling: every representation of one number
 * must collapse to the same E.164 identity, and anything unparseable
 * must fail closed (null) rather than pass through raw.
 */
describe("canonicalizePhoneNumber", () => {
  it("collapses Indian formatting variants to one E.164 identity", () => {
    const variants = [
      "+919876543210",
      "+91 98765 43210",
      "+91-98765-43210",
      "919876543210",
      "09876543210",
      "9876543210",
      " 98765 43210 ",
      "(98765) 43210",
    ];
    for (const variant of variants) {
      expect(canonicalizePhoneNumber(variant)).toBe("+919876543210");
    }
  });

  it("keeps a non-Indian international number in E.164 form", () => {
    expect(canonicalizePhoneNumber("+14155552671")).toBe("+14155552671");
    expect(canonicalizePhoneNumber("+44 20 7946 0958")).toBe("+442079460958");
  });

  it("fails closed on unparseable input", () => {
    expect(canonicalizePhoneNumber("")).toBeNull();
    expect(canonicalizePhoneNumber("not a number")).toBeNull();
    expect(canonicalizePhoneNumber("+91")).toBeNull();
    expect(canonicalizePhoneNumber("+919876543210123456")).toBeNull();
    expect(canonicalizePhoneNumber("12345")).toBeNull();
    expect(canonicalizePhoneNumber("0987654321")).toBeNull();
    expect(canonicalizePhoneNumber(null)).toBeNull();
    expect(canonicalizePhoneNumber(9876543210)).toBeNull();
    expect(canonicalizePhoneNumber("+91 98765 ABCDE")).toBeNull();
  });

  it("deduplicates canonicalized lists, preserving order", () => {
    expect(
      canonicalizePhoneNumbers([
        "09876543210",
        "+919876543210",
        "garbage",
        "+14155552671",
        "9876543210",
      ]),
    ).toEqual(["+919876543210", "+14155552671"]);
  });
});

describe("maskPhoneNumber", () => {
  it("keeps only the country prefix and last two digits", () => {
    const masked = maskPhoneNumber("+919876543210");
    expect(masked.startsWith("+91")).toBe(true);
    expect(masked.endsWith("10")).toBe(true);
    expect(masked).not.toContain("98765432");
  });
});

/**
 * Strict India-only owner-entry parser: exactly 10 ASCII digits, and
 * nothing else. Every rejection below must be a null — never a
 * truncated, corrected, or reformatted acceptance. The lenient
 * canonicalizer above is a separate function for trusted Clerk values
 * and is deliberately NOT used for this field.
 */
describe("parseIndianMobileInput", () => {
  it("canonicalizes exactly 10 digits to +91 form", () => {
    expect(parseIndianMobileInput("9876543210")).toBe("+919876543210");
  });

  it("accepts valid numbers beginning with 6, 7, 8, and 9", () => {
    expect(parseIndianMobileInput("6123456789")).toBe("+916123456789");
    expect(parseIndianMobileInput("7123456789")).toBe("+917123456789");
    expect(parseIndianMobileInput("8123456789")).toBe("+918123456789");
    expect(parseIndianMobileInput("9123456789")).toBe("+919123456789");
  });

  it("rejects numbers beginning with 0, 1, 2, 3, 4, and 5", () => {
    expect(parseIndianMobileInput("0123456789")).toBeNull();
    expect(parseIndianMobileInput("1234567890")).toBeNull();
    expect(parseIndianMobileInput("2345678901")).toBeNull();
    expect(parseIndianMobileInput("3456789012")).toBeNull();
    expect(parseIndianMobileInput("4567890123")).toBeNull();
    expect(parseIndianMobileInput("5678901234")).toBeNull();
  });

  it("rejects country-code-prefixed and trunk-prefixed input", () => {
    expect(parseIndianMobileInput("+919876543210")).toBeNull();
    expect(parseIndianMobileInput("919876543210")).toBeNull();
    expect(parseIndianMobileInput("09876543210")).toBeNull();
    // 10 digits but starting with the trunk zero: still a leading-zero
    // number, not a bare mobile.
    expect(parseIndianMobileInput("0987654321")).toBeNull();
  });

  it("rejects wrong lengths without truncating or padding", () => {
    expect(parseIndianMobileInput("987654321")).toBeNull();
    expect(parseIndianMobileInput("98765432100")).toBeNull();
    expect(parseIndianMobileInput("")).toBeNull();
  });

  it("rejects whitespace, punctuation, and separators", () => {
    expect(parseIndianMobileInput("98765 43210")).toBeNull();
    expect(parseIndianMobileInput(" 9876543210")).toBeNull();
    expect(parseIndianMobileInput("9876543210 ")).toBeNull();
    expect(parseIndianMobileInput("987-654-3210")).toBeNull();
    expect(parseIndianMobileInput("98765.43210")).toBeNull();
    expect(parseIndianMobileInput("(987) 654-3210")).toBeNull();
  });

  it("rejects alphabetic, non-ASCII-digit, and non-string input", () => {
    expect(parseIndianMobileInput("abcdefghij")).toBeNull();
    expect(parseIndianMobileInput("98765abcde")).toBeNull();
    // Devanagari digits look like digits but are not ASCII 0–9.
    expect(parseIndianMobileInput("९८७६५४३२१०")).toBeNull();
    // A value that would "work" after stripping letters must not be
    // silently cleaned into an accepted number.
    expect(parseIndianMobileInput("9876543210abc")).toBeNull();
    expect(parseIndianMobileInput(null)).toBeNull();
    expect(parseIndianMobileInput(undefined)).toBeNull();
    expect(parseIndianMobileInput(9876543210)).toBeNull();
  });

  it("does not change the lenient canonicalizer's trusted-value behavior", () => {
    // Clerk may still report "+91 98765 43210" or "09876543210"; those
    // normalize for comparison and are not entry-field input.
    expect(canonicalizePhoneNumber("+91 98765 43210")).toBe(
      "+919876543210",
    );
    expect(canonicalizePhoneNumber("09876543210")).toBe("+919876543210");
  });
});

/**
 * Submitted-number matching: pure canonical equality. A formatted
 * verified Clerk value matches the entered digits; anything else —
 * including a different verified number — does not, and the caller
 * must not fall back to it.
 */
describe("findMatchingVerifiedPhone", () => {
  it("matches the entered number against a formatted verified Clerk value", () => {
    // Caller canonicalizes Clerk values first: "+91 98765 43210" is
    // "+919876543210" by comparison time.
    expect(
      findMatchingVerifiedPhone("+919876543210", ["+919876543210"]),
    ).toBe("+919876543210");
  });

  it("rejects a different number and an empty list", () => {
    expect(
      findMatchingVerifiedPhone("+919876543210", ["+919999999999"]),
    ).toBeNull();
    expect(findMatchingVerifiedPhone("+919876543210", [])).toBeNull();
  });

  it("never falls back to another verified number the owner did not enter", () => {
    expect(
      findMatchingVerifiedPhone("+919876543210", [
        "+919999999999",
        "+918888888888",
      ]),
    ).toBeNull();
  });
});
