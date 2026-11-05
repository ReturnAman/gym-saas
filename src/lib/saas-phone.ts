// Canonical verified-phone handling for SaaS trial eligibility.
//
// Trial eligibility keys on the owner's VERIFIED phone number, and the
// same number must always resolve to the same identity no matter how it
// was typed or returned: "+91 98765 43210", "09876543210", "919876543210"
// and "+919876543210" are one number, not four chances at a trial.
//
// This module is pure (no I/O, no secrets) so it can be unit-tested
// exhaustively. The verification itself lives in
// src/lib/server/clerk-verified-phone.ts — nothing here trusts a number
// merely because it was supplied; callers must only pass numbers that
// Clerk has already reported as verified.
//
// Two responsibilities are deliberately kept separate:
// - parseIndianMobileInput: the STRICT owner-entry parser for the V1
//   India-only onboarding field. It accepts exactly 10 ASCII digits
//   and nothing else — no country code, no trunk zero, no separators,
//   no whitespace, no silent truncation or correction.
// - canonicalizePhoneNumber: the LENIENT canonicalizer for TRUSTED
//   values only (numbers Clerk reports as verified, and historical
//   trial-claim identities). Those may legitimately arrive with "+91",
//   a trunk zero, or spacing, and must normalize for comparison rather
//   than be rejected by the entry parser. Never feed untrusted
//   browser input through the lenient canonicalizer and treat the
//   result as verified — verification comes from Clerk, not from
//   formatting.

/**
 * Normalize a phone number to canonical E.164 form, or null when it
 * cannot be parsed. Unparseable input fails closed: the caller treats
 * null as "no verified phone", never as a reason to trust the raw value.
 *
 * Rules, in order:
 * - Strip spaces, dashes, parentheses and dots.
 * - A leading "+" means the rest is already international: it must be
 *   8–15 digits (the E.164 range).
 * - Without "+": a leading "0" is a national trunk prefix (India:
 *   0 + 10-digit mobile → +91 + mobile); a 12-digit "91…" value is the
 *   Indian international form without "+"; a bare 10-digit value is an
 *   Indian mobile. Anything else is rejected.
 *
 * The India default for bare 10-digit numbers is a documented product
 * assumption: this is an India-first product (INR pricing, APITxT SMS,
 * TRAI/DLT rules). A number from another country must arrive in
 * international form (with "+") to be accepted.
 */
export function canonicalizePhoneNumber(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/[\s\-().]/g, "");
  if (cleaned.length === 0) return null;

  if (cleaned.startsWith("+")) {
    const digits = cleaned.slice(1);
    if (!/^\d+$/.test(digits)) return null;
    if (digits.length < 8 || digits.length > 15) return null;
    return `+${digits}`;
  }

  if (!/^\d+$/.test(cleaned)) return null;

  if (cleaned.startsWith("0")) {
    const withoutTrunk = cleaned.replace(/^0+/, "");
    if (withoutTrunk.length === 10) return `+91${withoutTrunk}`;
    return null;
  }
  if (cleaned.length === 12 && cleaned.startsWith("91")) {
    return `+${cleaned}`;
  }
  if (cleaned.length === 10) {
    return `+91${cleaned}`;
  }
  return null;
}

/**
 * Strict parser for the V1 India-only owner-entry field (onboarding).
 *
 * Accepts exactly 10 ASCII digits with the first digit between 6 and
 * 9 — the Indian mobile range — and returns the canonical E.164
 * identity ("9876543210" → "+919876543210"). Everything else returns
 * null — the caller rejects the submission, never truncates, guesses,
 * or silently corrects it:
 * - "+919876543210", "919876543210": country code must not be typed
 *   (the field displays "+91" separately).
 * - Numbers starting with 0–5: 0 is a trunk prefix, and 1–5 are not
 *   Indian mobile prefixes.
 * - "98765 43210", "987-654-3210", "98765.43210": separators and
 *   whitespace are not digits.
 * - "987654321", "98765432100": wrong length, never truncated to fit.
 * - "abcdefghij", non-ASCII digits (e.g. Devanagari digits), and
 *   non-string input: not ASCII digits 0–9.
 *
 * Deliberately no trimming: surrounding whitespace is invalid input,
 * not input to clean up silently. The format check is only a first
 * gate — the identity control remains the verified-Clerk match in the
 * onboarding action.
 */
export function parseIndianMobileInput(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (!/^[6-9][0-9]{9}$/.test(raw)) return null;
  return `+91${raw}`;
}

/**
 * Match a strictly parsed owner-entered number against the owner's
 * canonicalized verified Clerk numbers. Returns the matched canonical
 * number, or null when nothing matches.
 *
 * Pure canonical-equality: the submitted number is already the output
 * of parseIndianMobileInput and the verified list is already
 * canonicalized, so a Clerk-side formatting variant ("+91 98765 43210")
 * still matches the entered "9876543210". A null result means "no
 * trial on this number": the caller creates the gym in PENDING_PAYMENT,
 * it never means "fall back to some other verified number" — the trial,
 * if any, is for the number the owner actually entered.
 */
export function findMatchingVerifiedPhone(
  submittedCanonicalPhone: string,
  verifiedCanonicalPhones: string[],
): string | null {
  return verifiedCanonicalPhones.includes(submittedCanonicalPhone)
    ? submittedCanonicalPhone
    : null;
}

/**
 * Canonicalize a list of numbers, deduplicating the results and dropping
 * anything unparseable. Order is preserved (first verified number wins
 * at claim time).
 */
export function canonicalizePhoneNumbers(raw: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    const canonical = canonicalizePhoneNumber(value);
    if (canonical && !seen.has(canonical)) {
      seen.add(canonical);
      out.push(canonical);
    }
  }
  return out;
}

/**
 * Mask a canonical phone number for display in listings, logs and audit
 * metadata. Keeps the country prefix (up to 3 characters, e.g. "+91")
 * and the last 2 digits; everything between is replaced. The full
 * number lives only in the trial-claim ledger row itself, never in a
 * listing, a log line, or an audit event.
 */
export function maskPhoneNumber(canonicalPhone: string): string {
  const digits = canonicalPhone.replace(/\D/g, "");
  if (digits.length <= 4) return "•".repeat(Math.max(digits.length, 1));
  const prefix = canonicalPhone.startsWith("+")
    ? canonicalPhone.slice(0, 3)
    : "";
  const tail = canonicalPhone.slice(-2);
  const maskedCount = Math.max(canonicalPhone.length - prefix.length - 2, 1);
  return `${prefix}${"•".repeat(maskedCount)}${tail}`;
}
