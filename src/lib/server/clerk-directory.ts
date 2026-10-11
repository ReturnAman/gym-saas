import "server-only";

import { clerkClient } from "@clerk/nextjs/server";

/**
 * Clerk account directory lookup for staff management (Staff Management V1).
 *
 * This is the only module that queries Clerk's Backend API for account
 * resolution. The application User model deliberately stores no email
 * (identity sync in auth.ts keys on clerkUserId only), so an email address
 * can be resolved to an account only through Clerk, which remains the
 * single source of truth for email identity.
 *
 * Trust rules:
 * - The Backend API's email filter is not an exact-match guarantee, so a
 *   returned account counts only when one of its email addresses matches
 *   the queried address EXACTLY (case-insensitive) AND that address's
 *   verification status is "verified".
 * - Exactly one account may match. Zero matches (unregistered, unverified,
 *   or partial-only matches) and multiple matches both resolve to null —
 *   the caller fails safely with a sign-in-first message rather than
 *   guessing which account was meant.
 * - Provider failures throw ClerkDirectoryUnavailableError: a lookup outage
 *   is a retryable operational error, never a successful lookup and never
 *   a permission grant.
 *
 * Nothing returned here exposes more than the resolved account's Clerk ID
 * and display name; no other account data leaves this module.
 */

export interface ClerkDirectoryUser {
  clerkUserId: string;
  displayName: string | null;
}

function displayNameOf(user: {
  firstName: string | null;
  lastName: string | null;
}): string | null {
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || null;
}

/** Thrown when the Clerk Backend API cannot be reached or errors. */
export class ClerkDirectoryUnavailableError extends Error {
  constructor(
    message = "Account lookup is unavailable right now. Please try again.",
  ) {
    super(message);
    this.name = "ClerkDirectoryUnavailableError";
  }
}

/**
 * Resolve a normalized email address (trimmed, lowercased by the caller)
 * to the single Clerk account that owns it as a VERIFIED address, or null
 * when no account qualifies.
 */
export async function findClerkUserByVerifiedEmail(
  normalizedEmail: string,
): Promise<ClerkDirectoryUser | null> {
  let users;
  try {
    const client = await clerkClient();
    const response = await client.users.getUserList({
      emailAddress: [normalizedEmail],
      limit: 100,
    });
    users = response.data;
  } catch {
    throw new ClerkDirectoryUnavailableError();
  }

  const matches: ClerkDirectoryUser[] = [];
  const seen = new Set<string>();
  for (const user of users) {
    const hasVerifiedMatch = user.emailAddresses.some(
      (address) =>
        address.emailAddress.trim().toLowerCase() === normalizedEmail &&
        address.verification?.status === "verified",
    );
    if (hasVerifiedMatch && !seen.has(user.id)) {
      seen.add(user.id);
      matches.push({ clerkUserId: user.id, displayName: displayNameOf(user) });
    }
  }

  if (matches.length !== 1) {
    return null;
  }
  return matches[0] ?? null;
}

/**
 * Display names for a set of Clerk accounts, keyed by Clerk user ID.
 *
 * Presentation-only enrichment (for example, labeling rows in the staff
 * list): unlike the verified-email resolution above, this is never an
 * identity or authorization input, so a provider failure degrades to an
 * empty map — callers render a fallback label — instead of throwing.
 * Accounts Clerk does not return are simply absent from the map.
 */
export async function findClerkDisplayNamesById(
  clerkUserIds: string[],
): Promise<Map<string, string | null>> {
  const names = new Map<string, string | null>();
  const uniqueIds = [...new Set(clerkUserIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return names;
  }
  try {
    const client = await clerkClient();
    for (let start = 0; start < uniqueIds.length; start += 100) {
      const batch = uniqueIds.slice(start, start + 100);
      const response = await client.users.getUserList({
        userId: batch,
        limit: 100,
      });
      for (const user of response.data) {
        names.set(user.id, displayNameOf(user));
      }
    }
  } catch {
    return new Map();
  }
  return names;
}
