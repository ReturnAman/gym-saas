import "server-only";

import type { OrganizationSubscription, Prisma } from "@prisma/client";
import { redirect } from "next/navigation";

import {
  requireMemberContext,
  type MemberSessionContext,
} from "./member-session";
import {
  requireOrganizationContext,
  type OrganizationContext,
} from "./authorization";
import { db } from "./db";

/**
 * Central SaaS entitlement resolver and enforcement (trial/subscription
 * slice).
 *
 * The effective state is DERIVED from persisted timestamps on every
 * check — no scheduled job is required for expiration to be secure, and
 * no client-supplied state is ever trusted:
 *
 * - SUSPENDED: an administrator explicitly suspended the gym. This
 *   overrides any live trial or paid period.
 * - ACTIVE: a paid period is live (now < paidThroughAt) and not suspended.
 * - TRIAL_ACTIVE: the trial is live (now < trialEndsAt) and not suspended.
 * - EXPIRED: the gym once had a trial or paid period and both have lapsed.
 * - PENDING_PAYMENT: the gym never had a trial or paid period.
 *
 * Boundary rule, tested exactly: a period is live only while
 * now < endsAt. At the exact expiry timestamp it is expired.
 *
 * An organization with no subscription row at all (created before this
 * slice, or a read against a partially migrated database) resolves to
 * PENDING_PAYMENT — fail closed, never fail open.
 */

/** Seven 24-hour periods, in milliseconds. */
export const TRIAL_DURATION_MS = 7 * 24 * 60 * 60_000;
/** The final-48-hour offer-prompt window, in milliseconds. */
export const TRIAL_OFFER_WINDOW_MS = 48 * 60 * 60_000;

export type EffectiveSubscriptionState =
  | "TRIAL_ACTIVE"
  | "PENDING_PAYMENT"
  | "ACTIVE"
  | "EXPIRED"
  | "SUSPENDED";

export interface SubscriptionWindow {
  suspendedAt: Date | null;
  paidThroughAt: Date | null;
  trialEndsAt: Date | null;
}

export function resolveEffectiveState(
  subscription: SubscriptionWindow | null,
  now: Date,
): EffectiveSubscriptionState {
  if (!subscription) return "PENDING_PAYMENT";
  if (subscription.suspendedAt) return "SUSPENDED";
  const nowMs = now.getTime();
  if (
    subscription.paidThroughAt &&
    nowMs < subscription.paidThroughAt.getTime()
  ) {
    return "ACTIVE";
  }
  if (
    subscription.trialEndsAt &&
    nowMs < subscription.trialEndsAt.getTime()
  ) {
    return "TRIAL_ACTIVE";
  }
  if (subscription.paidThroughAt || subscription.trialEndsAt) {
    return "EXPIRED";
  }
  return "PENDING_PAYMENT";
}

/** States in which normal gym operations are allowed. */
export function isOperationsState(
  state: EffectiveSubscriptionState,
): boolean {
  return state === "TRIAL_ACTIVE" || state === "ACTIVE";
}

/** Milliseconds of trial remaining at `now`; null when no live trial. */
export function trialRemainingMs(
  subscription: SubscriptionWindow | null,
  now: Date,
): number | null {
  if (!subscription || !subscription.trialEndsAt) return null;
  const remaining = subscription.trialEndsAt.getTime() - now.getTime();
  return remaining > 0 ? remaining : null;
}

/**
 * Whether the final-48-hour offer prompt may be shown: the trial is live,
 * the gym is not suspended, and at most 48 hours remain. Expired trials
 * never show the prompt, and a suspended gym's trial window — even one
 * inside its final 48 hours — is not an active trial, so it never shows
 * the prompt either. Suspension does not pause the trial clock; it only
 * removes the gym from the offer-eligible state until reactivation.
 */
export function isInOfferWindow(
  subscription: SubscriptionWindow | null,
  now: Date,
): boolean {
  if (!subscription || subscription.suspendedAt) return false;
  const remaining = trialRemainingMs(subscription, now);
  return remaining !== null && remaining <= TRIAL_OFFER_WINDOW_MS;
}

export async function getOrganizationSubscription(
  organizationId: string,
): Promise<OrganizationSubscription | null> {
  return db.organizationSubscription.findUnique({
    where: { organizationId },
  });
}

/**
 * Owner-facing subscription view: the gym's own subscription row, its
 * offer requests (newest first), and its most recent SaaS payment.
 * Nothing here crosses tenants — the caller passes only the
 * organization resolved from their own membership.
 */
export async function getOwnerSubscriptionView(organizationId: string) {
  const [subscription, offers, payments] = await Promise.all([
    db.organizationSubscription.findUnique({ where: { organizationId } }),
    db.saasOfferRequest.findMany({
      where: { organizationId },
      orderBy: { requestedAt: "desc" },
    }),
    db.saasSubscriptionPayment.findMany({
      where: { organizationId },
      orderBy: { receivedAt: "desc" },
      take: 1,
    }),
  ]);
  return {
    subscription,
    state: resolveEffectiveState(subscription, new Date()),
    offers,
    latestPayment: payments[0] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Enforcement
// ---------------------------------------------------------------------------

/** Thrown when a restricted gym attempts a normal operation. */
export class SubscriptionRestrictedError extends Error {
  readonly state: EffectiveSubscriptionState;

  constructor(state: EffectiveSubscriptionState) {
    super(
      "This gym's subscription does not allow this operation. " +
        "Contact the Gym SaaS team to arrange continuation.",
    );
    this.name = "SubscriptionRestrictedError";
    this.state = state;
  }
}

/**
 * Block a normal operation unless the gym's effective state allows it.
 * Reads the live subscription row — never a cached or client-supplied
 * state. Callers map this error to the project's safe error format;
 * the message deliberately reveals no other tenant's information.
 */
export async function assertOperationsAllowed(
  organizationId: string,
): Promise<void> {
  const subscription = await getOrganizationSubscription(organizationId);
  const state = resolveEffectiveState(subscription, new Date());
  if (!isOperationsState(state)) {
    throw new SubscriptionRestrictedError(state);
  }
}

/**
 * Same check inside a mutation transaction: the subscription row is read
 * through the caller's transaction client so the check and the mutation
 * observe one consistent snapshot.
 */
export async function assertOperationsAllowedInTransaction(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<void> {
  const subscription = await tx.organizationSubscription.findUnique({
    where: { organizationId },
  });
  const state = resolveEffectiveState(subscription, new Date());
  if (!isOperationsState(state)) {
    throw new SubscriptionRestrictedError(state);
  }
}

/**
 * Owner/staff protected-area context with entitlement enforcement: an
 * authenticated member of a restricted gym is sent to the subscription
 * screen instead of the protected page. The subscription screen itself
 * must use requireOrganizationContext directly (not this wrapper), or
 * restricted owners could never reach it.
 */
export async function requireEntitledOrganizationContext(): Promise<OrganizationContext> {
  const context = await requireOrganizationContext();
  const subscription = await getOrganizationSubscription(
    context.organization.id,
  );
  const state = resolveEffectiveState(subscription, new Date());
  if (!isOperationsState(state)) {
    redirect("/app/subscription");
  }
  return context;
}

/**
 * Member protected-area context with entitlement enforcement: members of
 * a restricted gym are sent to a generic restricted notice instead of
 * gym operations. Member sign-in itself is never gated — authentication
 * must always remain possible.
 */
export async function requireEntitledMemberContext(): Promise<MemberSessionContext> {
  const context = await requireMemberContext();
  const subscription = await getOrganizationSubscription(
    context.organization.id,
  );
  const state = resolveEffectiveState(subscription, new Date());
  if (!isOperationsState(state)) {
    redirect("/member/restricted");
  }
  return context;
}

// ---------------------------------------------------------------------------
// Trial claims (used by organization creation; see organizations.ts)
// ---------------------------------------------------------------------------

export interface TrialClaimAttempt {
  granted: boolean;
  /** The canonical phone the trial was claimed with, when granted. */
  canonicalPhone: string | null;
}

/**
 * Attempt an introductory-trial claim inside the caller's transaction.
 *
 * Concurrency (ADR 013 — database constraints, not prechecks):
 * - One advisory lock per identity, taken in a fixed global order
 *   (owner lock first, then phone locks in sorted order), so concurrent
 *   claims for the same owner or the same phone linearize here instead
 *   of racing past the existence checks below.
 * - The checks then observe a stable picture: an existing claim for the
 *   owner (any phone) or for any candidate phone means no new trial.
 * - The database unique constraints on saas_trial_claims
 *   (clerk_user_id, canonical_phone) remain the final backstop: if a
 *   P2002 still escapes (e.g. a claim created outside this lock order),
 *   the caller must treat the whole creation as trial-less and retry
 *   without a claim — never as a granted trial. See
 *   createOrganizationWithSubscription in organizations.ts.
 *
 * Returns granted=false (no row written, no error) when the owner or
 * every candidate phone has already consumed a trial. The caller then
 * leaves the subscription in PENDING_PAYMENT; the organization itself
 * is still created.
 */
export async function claimTrialInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    clerkUserId: string;
    canonicalPhones: string[];
    organizationId: string;
  },
): Promise<TrialClaimAttempt> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${"saas-trial-owner:" + input.clerkUserId}))
  `;

  const existingOwnerClaim = await tx.saasTrialClaim.findUnique({
    where: { clerkUserId: input.clerkUserId },
  });
  if (existingOwnerClaim) {
    return { granted: false, canonicalPhone: null };
  }

  const phones = [...new Set(input.canonicalPhones)].sort();
  for (const canonicalPhone of phones) {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${"saas-trial-phone:" + canonicalPhone}))
    `;
    const existingPhoneClaim = await tx.saasTrialClaim.findUnique({
      where: { canonicalPhone },
    });
    if (existingPhoneClaim) {
      continue;
    }
    await tx.saasTrialClaim.create({
      data: {
        clerkUserId: input.clerkUserId,
        canonicalPhone,
        organizationId: input.organizationId,
      },
    });
    return { granted: true, canonicalPhone };
  }
  return { granted: false, canonicalPhone: null };
}
