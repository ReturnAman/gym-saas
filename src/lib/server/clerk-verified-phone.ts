import "server-only";

import { clerkClient } from "@clerk/nextjs/server";

/**
 * Verified owner phone numbers from Clerk's Backend API.
 *
 * Trust rules (mirroring clerk-directory.ts):
 * - The phone number counts only when Clerk reports its verification
 *   status as exactly "verified". An unverified, merely present, or
 *   client-asserted number is never returned.
 * - This module returns raw numbers only to server-side callers; callers
 *   canonicalize them (saas-phone.ts) and never log or render them in
 *   full.
 * - A provider failure throws ClerkPhoneLookupUnavailableError: a lookup
 *   outage is a retryable operational error, never a successful lookup
 *   and never a permission or eligibility grant. Callers that need a
 *   trial decision must abort the operation on this error rather than
 *   silently treating the owner as phone-less.
 */

/** Thrown when Clerk's Backend API cannot be reached or errors. */
export class ClerkPhoneLookupUnavailableError extends Error {
  constructor(
    message = "Phone verification is unavailable right now. Please try again.",
  ) {
    super(message);
    this.name = "ClerkPhoneLookupUnavailableError";
  }
}

/**
 * All verified phone numbers on the Clerk account, in Clerk's own order.
 * Returns an empty list when the account has no verified number — that
 * is a real answer (the owner is not trial-eligible by phone), distinct
 * from the thrown error above.
 */
export async function getVerifiedPhoneNumbersForClerkUser(
  clerkUserId: string,
): Promise<string[]> {
  let user;
  try {
    const client = await clerkClient();
    user = await client.users.getUser(clerkUserId);
  } catch {
    throw new ClerkPhoneLookupUnavailableError();
  }
  return (user.phoneNumbers ?? [])
    .filter((phone) => phone.verification?.status === "verified")
    .map((phone) => phone.phoneNumber)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}
