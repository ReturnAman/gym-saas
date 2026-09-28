// Server-side Clerk identity → application User resolution.
//
// The application User is the application's own identity record, distinct
// from the Clerk identity (ADR 001 §5, ADR 015 §5). Clerk establishes *who*
// the person is; this module resolves (creating on first sight) the stable
// internal User row the domain references.
//
// Security rules:
// - Authentication is always read server-side via Clerk's `auth()`.
// - Client-provided user IDs are never trusted.
// - The unique constraint on users.clerk_user_id makes synchronization
//   idempotent: repeated calls for the same Clerk identity return the same
//   User row and can never create duplicates.

import "server-only";
import { auth } from "@clerk/nextjs/server";
import type { User } from "@prisma/client";
import { redirect } from "next/navigation";
import { db } from "./db";

/**
 * Resolve the current Clerk identity to the application User.
 *
 * Idempotent: uses upsert on the unique clerk_user_id, so it is safe to
 * call on every authenticated request without creating duplicate users.
 *
 * Returns null when there is no authenticated Clerk identity.
 */
export async function getCurrentUser(): Promise<User | null> {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return null;
  }
  return db.user.upsert({
    where: { clerkUserId },
    update: {},
    create: { clerkUserId },
  });
}

/**
 * Same as getCurrentUser(), but redirects unauthenticated visitors to the
 * sign-in page. Use at the top of protected server components.
 */
export async function requireCurrentUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/sign-in");
  }
  return user;
}
