// Idempotency tokens for payment-creating operations (H4).
//
// A form renders ONE token per intentional operation and resubmits the
// same token on every retry of that operation (double-click, concurrent
// duplicate, retry after a timeout or a lost response). The server
// stores the token on the Payment row under a database unique index
// scoped to the organization, so the same token can create at most one
// payment; a genuinely new payment always uses a new token. This module
// is pure and client-safe: the forms generate tokens with it, the
// services validate them with it.

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,63}$/;

/** A token is 16–64 chars: letters, digits, "-" or "_". */
export function isValidIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && KEY_PATTERN.test(value);
}

/** Generate a fresh operation token (a UUID in practice). */
export function newIdempotencyToken(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  // Fallback for environments without randomUUID: 128 bits of
  // randomness, hex-encoded (still satisfies the key pattern).
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
