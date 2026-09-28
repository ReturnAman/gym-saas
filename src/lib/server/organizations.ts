import "server-only";

import type { Organization } from "@prisma/client";

import { db } from "./db";

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
export const MAX_ORGANIZATION_NAME_LENGTH = 120;

export interface CreateOrganizationInput {
  name: string;
}

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
