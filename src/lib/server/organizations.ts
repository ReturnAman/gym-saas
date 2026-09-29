import "server-only";

import type { Organization } from "@prisma/client";

import {
  MAX_ORGANIZATION_NAME_LENGTH,
  validateOrganizationProfile,
  type OrganizationProfileInput,
} from "../organization-profile";
import { getPrimaryMembership, hasRole } from "./authorization";
import { db } from "./db";

// Re-exported so existing import sites keep working; the pure validation
// module itself stays free of `server-only` for client-component use.
export {
  MAX_ORGANIZATION_ADDRESS_LENGTH,
  MAX_ORGANIZATION_EMAIL_LENGTH,
  MAX_ORGANIZATION_NAME_LENGTH,
  MAX_ORGANIZATION_PHONE_LENGTH,
  OrganizationProfileValidationError,
  validateOrganizationProfile,
  type OrganizationProfileData,
  type OrganizationProfileField,
  type OrganizationProfileInput,
} from "../organization-profile";

/** Thrown when the caller may not update the gym profile. */
export class OrganizationProfileAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrganizationProfileAuthorizationError";
  }
}

/**
 * Update the gym profile for the caller's organization.
 *
 * Authorization (ADR 015 §14–§15, AGENTS.md §6–§7):
 * - The organization is resolved from the authenticated user's own
 *   membership — the function accepts no organization ID, so a user from
 *   Organization A cannot name Organization B.
 * - Only OWNER may update (V1 rule). Hiding the edit UI is not sufficient;
 *   this check is enforced here, server-side.
 * - Only the validated allow-list fields are written; arbitrary
 *   client-supplied fields can never reach the database.
 */
export async function updateOrganizationProfile(
  userId: string,
  input: OrganizationProfileInput,
): Promise<Organization> {
  if (!userId) {
    throw new OrganizationProfileAuthorizationError(
      "Authentication is required to update the gym profile.",
    );
  }

  const membership = await getPrimaryMembership(userId);
  if (!membership) {
    throw new OrganizationProfileAuthorizationError(
      "You do not belong to an organization.",
    );
  }
  if (!hasRole(membership, "OWNER")) {
    throw new OrganizationProfileAuthorizationError(
      "Only the organization owner can update the gym profile.",
    );
  }

  const data = validateOrganizationProfile(input);

  return db.organization.update({
    where: { id: membership.organizationId },
    data,
  });
}

export interface CreateOrganizationInput {
  name: string;
}

/**
 * Minimum server-side operation for creating a gym organization
 * (ADR 010 §7, ADR 015 §14).
 *
 * Creates the Organization and, in the same atomic transaction, the
 * OrganizationMembership granting the creating user the OWNER role.
 * Atomicity means a failed membership insert can never leave an
 * owner-less organization behind (and vice versa); the UNIQUE constraint
 * on (user_id, organization_id) makes duplicate memberships impossible at
 * the database level.
 *
 * Authentication is enforced by the caller (the server action requires the
 * authenticated application User); this function additionally refuses an
 * empty user ID defensively.
 */
export async function createOrganization(
  userId: string,
  input: CreateOrganizationInput,
): Promise<Organization> {
  if (!userId) {
    throw new Error("Authentication is required to create an organization.");
  }

  const name = input.name.trim();
  if (!name) {
    throw new Error("Gym name is required.");
  }
  if (name.length > MAX_ORGANIZATION_NAME_LENGTH) {
    throw new Error(
      `Gym name must be at most ${MAX_ORGANIZATION_NAME_LENGTH} characters.`,
    );
  }

  return db.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: { name },
    });
    await tx.organizationMembership.create({
      data: {
        userId,
        organizationId: organization.id,
        role: "OWNER",
      },
    });
    return organization;
  });
}
