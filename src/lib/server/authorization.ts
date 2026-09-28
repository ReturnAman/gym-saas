import "server-only";

import type {
  Organization,
  OrganizationMembership,
  Role,
  User,
} from "@prisma/client";
import { redirect } from "next/navigation";

import { getCurrentUser } from "./auth";
import { db } from "./db";

/**
 * Server-side authorization foundation (ADR 015 §14–§15).
 *
 * Every function here runs server-side and derives authorization from the
 * database. Organization IDs and roles are never accepted from the client as
 * authoritative: membership rows are looked up by the authenticated user's
 * own application User ID, and roles are read from those rows.
 */

export type MembershipWithOrganization = OrganizationMembership & {
  organization: Organization;
};

/**
 * All of a user's organization memberships, oldest first, each carrying its
 * organization. Reads only rows belonging to the given application user.
 */
export async function getUserMemberships(
  userId: string,
): Promise<MembershipWithOrganization[]> {
  return db.organizationMembership.findMany({
    where: { userId },
    include: { organization: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * The user's earliest organization membership (their first gym). Used for
 * first-time onboarding checks and for deriving the organization in V1,
 * where organization switching UI does not exist yet.
 */
export async function getPrimaryMembership(
  userId: string,
): Promise<MembershipWithOrganization | null> {
  return db.organizationMembership.findFirst({
    where: { userId },
    include: { organization: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Require that a user belongs to a specific organization. Returns the
 * membership (with organization) when it exists; otherwise redirects away
 * without ever exposing that organization's data. The organization ID here
 * is only ever used as a lookup key against the user's own membership rows —
 * never as proof of authorization on its own.
 */
export async function requireOrganizationMembership(
  userId: string,
  organizationId: string,
): Promise<MembershipWithOrganization> {
  const membership = await db.organizationMembership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    include: { organization: true },
  });
  if (!membership) {
    redirect("/app");
  }
  return membership;
}

/**
 * Role check against a server-loaded membership row. Roles come from the
 * database, never from client input.
 */
export function hasRole(
  membership: OrganizationMembership,
  ...roles: Role[]
): boolean {
  return roles.includes(membership.role);
}

export interface OrganizationContext {
  user: User;
  membership: MembershipWithOrganization;
  organization: Organization;
}

/**
 * Full server-side context for the organization's protected area:
 * authenticated user → their primary membership → that organization.
 * Redirects to /sign-in when unauthenticated, /onboarding when the user has
 * no organization yet. The organization is derived purely from server-side
 * membership data — no client-provided organization ID or role is involved.
 */
export async function requireOrganizationContext(): Promise<OrganizationContext> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/sign-in");
  }
  const membership = await getPrimaryMembership(user.id);
  if (!membership) {
    redirect("/onboarding");
  }
  return { user, membership, organization: membership.organization };
}
