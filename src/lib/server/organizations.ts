import "server-only";

import type { Organization } from "@prisma/client";
import { Prisma } from "@prisma/client";

import {
  MAX_ORGANIZATION_NAME_LENGTH,
  validateOrganizationProfile,
  type OrganizationProfileInput,
} from "../organization-profile";
import { getPrimaryMembership, hasRole } from "./authorization";
import {
  AUDIT_EVENT_SAAS_TRIAL_GRANTED,
  writeAuditEvent,
} from "./audit";
import { db } from "./db";
import {
  TRIAL_DURATION_MS,
  assertOperationsAllowed,
  claimTrialInTransaction,
} from "./subscriptions";
import { maskPhoneNumber } from "../saas-phone";

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
  // SaaS entitlement: profile edits are normal gym operations.
  await assertOperationsAllowed(membership.organizationId);

  const data = validateOrganizationProfile(input);

  return db.organization.update({
    where: { id: membership.organizationId },
    data,
  });
}

export interface CreateOrganizationInput {
  name: string;
}

/** Shared gym-name validation for both creation entry points. */
function validateOrganizationName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Gym name is required.");
  }
  if (trimmed.length > MAX_ORGANIZATION_NAME_LENGTH) {
    throw new Error(
      `Gym name must be at most ${MAX_ORGANIZATION_NAME_LENGTH} characters.`,
    );
  }
  return trimmed;
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

  const name = validateOrganizationName(input.name);

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

export interface CreateOrganizationWithSubscriptionResult {
  organization: Organization;
  /** True only when an introductory trial was granted AND claimed. */
  trialGranted: boolean;
  trialEndsAt: Date | null;
}

/**
 * Organization creation with SaaS trial/subscription provisioning (trial
 * slice). This is the only creation path the onboarding flow uses.
 *
 * In one transaction it creates the Organization, the OWNER membership,
 * the 1:1 OrganizationSubscription row, and — when the owner is
 * eligible — the permanent SaasTrialClaim row. Eligibility requires
 * BOTH: a stable Clerk owner identity that has never claimed, and at
 * least one canonical verified phone number that has never claimed.
 * `canonicalPhones` must already be canonicalized verified numbers
 * (saas-phone.ts); raw or unverified numbers must never reach this
 * function.
 *
 * Trial-less outcomes are normal, not errors: no verified phone, a
 * previous claim by this owner, or a previous claim for every candidate
 * phone all produce a subscription in PENDING_PAYMENT and the gym is
 * still created — the platform admin activates it after manual payment
 * verification. What never happens is a second introductory trial.
 *
 * Concurrency backstop: the claim itself serializes on advisory locks
 * (see claimTrialInTransaction), and the ledger's unique constraints
 * are the final authority. If a P2002 on saas_trial_claims still
 * escapes — a claim created outside the lock order — the whole
 * transaction has rolled back, so creation is retried exactly once
 * without a trial claim. A failed claim can therefore never surface as
 * a granted trial or a partial subscription.
 */
export async function createOrganizationWithSubscription(
  userId: string,
  clerkUserId: string | null,
  canonicalPhones: string[],
  input: CreateOrganizationInput,
): Promise<CreateOrganizationWithSubscriptionResult> {
  if (!userId) {
    throw new Error("Authentication is required to create an organization.");
  }
  const name = validateOrganizationName(input.name);

  const attempt = async (
    phones: string[],
  ): Promise<CreateOrganizationWithSubscriptionResult> =>
    db.$transaction(async (tx) => {
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

      let trialEndsAt: Date | null = null;
      let trialGranted = false;
      if (clerkUserId && phones.length > 0) {
        const claim = await claimTrialInTransaction(tx, {
          clerkUserId,
          canonicalPhones: phones,
          organizationId: organization.id,
        });
        if (claim.granted) {
          const trialStartedAt = new Date();
          trialEndsAt = new Date(
            trialStartedAt.getTime() + TRIAL_DURATION_MS,
          );
          trialGranted = true;
          await tx.organizationSubscription.create({
            data: {
              organizationId: organization.id,
              trialStartedAt,
              trialEndsAt,
            },
          });
          await writeAuditEvent(tx, {
            organizationId: organization.id,
            actorUserId: userId,
            event: AUDIT_EVENT_SAAS_TRIAL_GRANTED,
            targetType: "OrganizationSubscription",
            targetId: organization.id,
            metadata: {
              trialStartedAt: trialStartedAt.toISOString(),
              trialEndsAt: trialEndsAt.toISOString(),
              // Masked on purpose: the full number lives only in the
              // claim ledger row, never in a log or audit event.
              canonicalPhoneMasked: claim.canonicalPhone
                ? maskPhoneNumber(claim.canonicalPhone)
                : null,
            },
          });
          return { organization, trialGranted, trialEndsAt };
        }
      }
      await tx.organizationSubscription.create({
        data: { organizationId: organization.id },
      });
      return { organization, trialGranted, trialEndsAt };
    });

  try {
    return await attempt(canonicalPhones);
  } catch (error) {
    if (isTrialClaimConflict(error)) {
      // The first attempt rolled back completely (no org, no claim, no
      // subscription). Retry once, trial-less, so a raced claim degrades
      // to PENDING_PAYMENT instead of failing gym creation.
      return attempt([]);
    }
    throw error;
  }
}

/**
 * True when the error is a unique conflict on the trial-claim ledger.
 * Prisma reports P2002 targets as model field names, so the claim's two
 * globally unique fields are the signature — no other insert in this
 * transaction can conflict (organization and subscription rows use fresh
 * UUIDs, and the membership pairs a fresh organization id).
 */
function isTrialClaimConflict(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    const target = (error.meta?.target as string[] | undefined) ?? [];
    return target.some(
      (field) => field === "clerkUserId" || field === "canonicalPhone",
    );
  }
  return false;
}
