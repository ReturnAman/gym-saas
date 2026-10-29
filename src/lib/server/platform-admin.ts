import "server-only";

import { auth } from "@clerk/nextjs/server";
import type {
  Organization,
  OrganizationSubscription,
  SaasOfferRequest,
  SaasSubscriptionPayment,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";

import { getCurrentUser } from "./auth";
import {
  AUDIT_EVENT_SAAS_OFFER_ACCEPTED,
  AUDIT_EVENT_SAAS_OFFER_APPROVED,
  AUDIT_EVENT_SAAS_OFFER_DECLINED,
  AUDIT_EVENT_SAAS_OFFER_REQUESTED,
  AUDIT_EVENT_SAAS_PAYMENT_RECORDED,
  AUDIT_EVENT_SAAS_SUBSCRIPTION_REACTIVATED,
  AUDIT_EVENT_SAAS_SUBSCRIPTION_SUSPENDED,
  AUDIT_EVENT_SAAS_TRIAL_EXTENDED,
  writeAuditEvent,
} from "./audit";
import { findClerkDisplayNamesById } from "./clerk-directory";
import { db } from "./db";
import {
  isInOfferWindow,
  resolveEffectiveState,
  TRIAL_OFFER_WINDOW_MS,
  type EffectiveSubscriptionState,
} from "./subscriptions";
import { isValidIdempotencyKey } from "../idempotency";

/**
 * Platform administration (trial/subscription slice).
 *
 * The platform administrator is NOT a gym role. Gym roles (OWNER, ADMIN,
 * STAFF, …) never grant platform-admin access, and no organization owner
 * can promote themselves: access comes only from the server-side
 * allowlist PLATFORM_ADMIN_CLERK_USER_IDS, compared against the
 * authenticated Clerk user ID on every page and mutation.
 *
 * Allowlist format: comma-separated stable Clerk user IDs, e.g.
 *   PLATFORM_ADMIN_CLERK_USER_IDS=user_abc,user_def
 * Missing, empty, or unparseable configuration fails closed: nobody is
 * an administrator. The variable is read only on the server (this module
 * is server-only) and real IDs must never be committed to source.
 */

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

/** Parse the allowlist value: comma-separated IDs, trimmed, empties dropped. */
export function parsePlatformAdminAllowlist(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of value.split(",")) {
    const id = part.trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** The configured allowlist from the server environment (fail closed). */
export function getPlatformAdminAllowlist(
  source: NodeJS.ProcessEnv = process.env,
): string[] {
  return parsePlatformAdminAllowlist(source.PLATFORM_ADMIN_CLERK_USER_IDS);
}

/** Pure authorization decision: is this Clerk identity allowlisted? */
export function isPlatformAdmin(
  clerkUserId: string | null,
  allowlist: string[],
): boolean {
  return !!clerkUserId && allowlist.includes(clerkUserId);
}

/** Thrown when a platform-admin-only operation is attempted by anyone else. */
export class PlatformAdminAuthorizationError extends Error {
  constructor(message = "Platform administrator access is required.") {
    super(message);
    this.name = "PlatformAdminAuthorizationError";
  }
}

export interface PlatformAdminContext {
  clerkUserId: string;
  /** The administrator's application User row (audit actor). */
  userId: string;
}

/**
 * Require platform-admin access for a page or server action.
 * Unauthenticated visitors go to sign-in; authenticated non-administrators
 * go to the gym area (a generic destination that reveals nothing about
 * the admin area's existence or contents).
 */
export async function requirePlatformAdmin(): Promise<PlatformAdminContext> {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    redirect("/sign-in");
  }
  if (!isPlatformAdmin(clerkUserId, getPlatformAdminAllowlist())) {
    redirect("/app");
  }
  const user = await getCurrentUser();
  if (!user) {
    redirect("/sign-in");
  }
  return { clerkUserId, userId: user.id };
}

// ---------------------------------------------------------------------------
// Validation helpers (shared by the admin mutations)
// ---------------------------------------------------------------------------

/** Thrown for invalid admin input; callers surface the message as-is. */
export class PlatformAdminValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformAdminValidationError";
  }
}

function requireReasonableText(
  value: unknown,
  field: string,
  maxLength: number,
  required: boolean,
): string | null {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw new PlatformAdminValidationError(`${field} is required.`);
    }
    return null;
  }
  if (typeof value !== "string") {
    throw new PlatformAdminValidationError(`${field} must be text.`);
  }
  const trimmed = value.trim();
  if (required && trimmed.length === 0) {
    throw new PlatformAdminValidationError(`${field} is required.`);
  }
  if (trimmed.length > maxLength) {
    throw new PlatformAdminValidationError(
      `${field} must be at most ${maxLength} characters.`,
    );
  }
  return trimmed;
}

/** Parse an INR amount string into an exact Decimal. No floats anywhere. */
export function parseMoneyAmount(value: unknown): Prisma.Decimal {
  if (typeof value !== "string" || !/^\d+(\.\d{1,2})?$/.test(value.trim())) {
    throw new PlatformAdminValidationError(
      "Amount must be a number with at most two decimal places.",
    );
  }
  const amount = new Prisma.Decimal(value.trim());
  if (amount.lte(0)) {
    throw new PlatformAdminValidationError("Amount must be greater than zero.");
  }
  if (amount.gt(new Prisma.Decimal("9999999999.99"))) {
    throw new PlatformAdminValidationError("Amount is too large.");
  }
  return amount;
}

/**
 * Parse a calendar date (YYYY-MM-DD, as submitted by a date input) as
 * UTC midnight. Throws on anything unparseable — never silently accept
 * an invalid date.
 */
export function parseCalendarDate(value: unknown, field: string): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    throw new PlatformAdminValidationError(
      `${field} must be a valid date (YYYY-MM-DD).`,
    );
  }
  const date = new Date(`${value.trim()}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new PlatformAdminValidationError(`${field} must be a valid date.`);
  }
  return date;
}

function requirePeriod(
  start: Date,
  end: Date,
): { periodStartAt: Date; periodEndAt: Date } {
  if (end.getTime() <= start.getTime()) {
    throw new PlatformAdminValidationError(
      "The period end must be after the period start.",
    );
  }
  return { periodStartAt: start, periodEndAt: end };
}

/** Load a subscription row or fail with a message that leaks nothing. */
async function requireSubscriptionRow(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<OrganizationSubscription> {
  const existing = await tx.organizationSubscription.findUnique({
    where: { organizationId },
  });
  if (existing) return existing;
  // Organizations created before this slice have no row; create one so
  // admin actions work uniformly. It starts empty (PENDING_PAYMENT).
  return tx.organizationSubscription.create({
    data: { organizationId },
  });
}

// ---------------------------------------------------------------------------
// Dashboard queries
// ---------------------------------------------------------------------------

export interface AdminOrganizationRow {
  organization: Organization;
  ownerClerkUserId: string | null;
  ownerDisplayName: string | null;
  subscription: OrganizationSubscription | null;
  state: EffectiveSubscriptionState;
  trialRemainingMs: number | null;
  pendingOffer: SaasOfferRequest | null;
  latestOffer: SaasOfferRequest | null;
  latestPayment: SaasSubscriptionPayment | null;
}

export interface AdminOverview {
  metrics: {
    activeTrials: number;
    awaitingPayment: number;
    expiringWithin48Hours: number;
    expiredOrSuspended: number;
    totalOrganizations: number;
  };
  organizations: AdminOrganizationRow[];
}

/**
 * Real database-backed overview: metrics are counted from live
 * subscription rows (never seeded or fabricated), and the list carries
 * the data the dashboard renders. Search matches gym names
 * case-insensitively; an empty query lists everything, newest first.
 */
export async function getPlatformAdminOverview(
  search: string,
): Promise<AdminOverview> {
  const now = new Date();
  const query = search.trim();
  const organizations = await db.organization.findMany({
    where: query
      ? { name: { contains: query, mode: "insensitive" } }
      : undefined,
    include: {
      subscription: true,
      memberships: {
        where: { role: "OWNER" },
        include: { user: true },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
      saasOffers: { orderBy: { requestedAt: "desc" }, take: 1 },
      saasPayments: { orderBy: { receivedAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });

  const ownerClerkIds = organizations
    .map((org) => org.memberships[0]?.user.clerkUserId)
    .filter((id): id is string => !!id);
  const displayNames = await findClerkDisplayNamesById(ownerClerkIds);

  const rows: AdminOrganizationRow[] = organizations.map((org) => {
    const subscription = org.subscription;
    const state = resolveEffectiveState(subscription, now);
    const trialRemainingMs =
      subscription?.trialEndsAt &&
      subscription.trialEndsAt.getTime() > now.getTime()
        ? subscription.trialEndsAt.getTime() - now.getTime()
        : null;
    const latestOffer = org.saasOffers[0] ?? null;
    return {
      organization: org,
      ownerClerkUserId: org.memberships[0]?.user.clerkUserId ?? null,
      ownerDisplayName:
        displayNames.get(org.memberships[0]?.user.clerkUserId ?? "") ?? null,
      subscription,
      state,
      trialRemainingMs,
      pendingOffer:
        latestOffer && latestOffer.status === "REQUESTED" ? latestOffer : null,
      latestOffer,
      latestPayment: org.saasPayments[0] ?? null,
    };
  });

  // Metrics are global, not filtered: a search narrows the list below but
  // must not change the headline counts. Only the three window fields are
  // loaded for this pass (resolveEffectiveState needs nothing else).
  const allSubscriptions = await db.organizationSubscription.findMany({
    select: { suspendedAt: true, paidThroughAt: true, trialEndsAt: true },
  });
  const allStates = allSubscriptions.map((s) =>
    resolveEffectiveState(s, now),
  );
  return {
    metrics: {
      activeTrials: allStates.filter((s) => s === "TRIAL_ACTIVE").length,
      awaitingPayment: allStates.filter((s) => s === "PENDING_PAYMENT")
        .length,
      expiringWithin48Hours: allSubscriptions.filter((s) => {
        const state = resolveEffectiveState(s, now);
        return (
          state === "TRIAL_ACTIVE" &&
          s.trialEndsAt !== null &&
          s.trialEndsAt.getTime() - now.getTime() <= TRIAL_OFFER_WINDOW_MS
        );
      }).length,
      expiredOrSuspended: allStates.filter(
        (s) => s === "EXPIRED" || s === "SUSPENDED",
      ).length,
      totalOrganizations: allStates.length,
    },
    organizations: rows,
  };
}

/** One organization's admin detail: row + payments + offers + recent audits. */
export async function getPlatformAdminOrganizationDetail(
  organizationId: string,
) {
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    include: {
      subscription: true,
      memberships: {
        where: { role: "OWNER" },
        include: { user: true },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
      saasPayments: { orderBy: { receivedAt: "desc" } },
      saasOffers: { orderBy: { requestedAt: "desc" } },
      auditLogs: {
        where: { event: { startsWith: "SAAS_" } },
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  });
  if (!organization) return null;
  const ownerClerkId = organization.memberships[0]?.user.clerkUserId ?? null;
  const names = ownerClerkId
    ? await findClerkDisplayNamesById([ownerClerkId])
    : new Map();
  return {
    organization,
    subscription: organization.subscription,
    state: resolveEffectiveState(organization.subscription, new Date()),
    ownerClerkUserId: ownerClerkId,
    ownerDisplayName: ownerClerkId ? (names.get(ownerClerkId) ?? null) : null,
    payments: organization.saasPayments,
    offers: organization.saasOffers,
    auditLogs: organization.auditLogs,
  };
}

// ---------------------------------------------------------------------------
// Admin mutations (each: validate → one transaction → audit in the same tx)
// ---------------------------------------------------------------------------

export interface RecordPaymentInput {
  organizationId: string;
  amount: unknown;
  receivedAt: unknown;
  periodStartAt: unknown;
  periodEndAt: unknown;
  reference?: unknown;
  notes?: unknown;
  idempotencyKey?: unknown;
}

/**
 * Record a manually verified SaaS payment and grant its paid period,
 * atomically with the audit event. Recording a payment never touches
 * gym-member payments, balances, or membership dates — those live in a
 * different model with different authorization.
 *
 * Suspension is deliberately NOT cleared here: a suspended gym stays
 * suspended until an explicit reactivation, even after payment. The
 * returned state reflects that, so the dashboard shows the truth.
 *
 * A retried submission carrying the same idempotency key resolves to
 * the original payment instead of a second one. The key is mandatory:
 * a submission without one is rejected before anything is recorded,
 * because a payment stored with a NULL key could never be deduplicated
 * (PostgreSQL treats NULLs as distinct in the unique index), so a
 * retried submission would silently record a second payment. No
 * server-side fallback token is minted — a derived token (e.g. from
 * amount + period) would falsely merge distinct payments that happen
 * to share those fields. The admin form mints one token per render;
 * a submission without one is malformed, not a retry.
 */
export async function recordSaasPaymentAndActivate(
  admin: PlatformAdminContext,
  input: RecordPaymentInput,
): Promise<{ payment: SaasSubscriptionPayment; state: EffectiveSubscriptionState }> {
  const amount = parseMoneyAmount(input.amount);
  const receivedAt = parseCalendarDate(input.receivedAt, "Received date");
  const { periodStartAt, periodEndAt } = requirePeriod(
    parseCalendarDate(input.periodStartAt, "Period start"),
    parseCalendarDate(input.periodEndAt, "Period end"),
  );
  const reference = requireReasonableText(input.reference, "Reference", 200, false);
  const notes = requireReasonableText(input.notes, "Notes", 1000, false);
  const idempotencyKey =
    input.idempotencyKey === undefined || input.idempotencyKey === ""
      ? null
      : input.idempotencyKey;
  if (idempotencyKey === null) {
    throw new PlatformAdminValidationError(
      "Idempotency key is required. Resubmit from the payment form.",
    );
  }
  if (!isValidIdempotencyKey(idempotencyKey)) {
    throw new PlatformAdminValidationError("Invalid idempotency key.");
  }
  if (!input.organizationId) {
    throw new PlatformAdminValidationError("Organization is required.");
  }

  return db.$transaction(async (tx) => {
    if (idempotencyKey) {
      const existing = await tx.saasSubscriptionPayment.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId: input.organizationId,
            idempotencyKey,
          },
        },
      });
      if (existing) {
        const subscription = await requireSubscriptionRow(
          tx,
          input.organizationId,
        );
        return {
          payment: existing,
          state: resolveEffectiveState(subscription, new Date()),
        };
      }
    }

    const subscription = await requireSubscriptionRow(tx, input.organizationId);
    const payment = await tx.saasSubscriptionPayment.create({
      data: {
        organizationId: input.organizationId,
        subscriptionId: subscription.id,
        amount,
        receivedAt,
        reference,
        periodStartAt,
        periodEndAt,
        recordedByClerkUserId: admin.clerkUserId,
        notes,
        idempotencyKey,
      },
    });
    const updated = await tx.organizationSubscription.update({
      where: { id: subscription.id },
      data: {
        paidPeriodStartAt: periodStartAt,
        paidPeriodEndAt: periodEndAt,
        paidThroughAt: periodEndAt,
      },
    });
    await writeAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: admin.userId,
      event: AUDIT_EVENT_SAAS_PAYMENT_RECORDED,
      targetType: "SaasSubscriptionPayment",
      targetId: payment.id,
      metadata: {
        amount: amount.toString(),
        periodStartAt: periodStartAt.toISOString(),
        periodEndAt: periodEndAt.toISOString(),
        previousPaidThroughAt: subscription.paidThroughAt?.toISOString() ?? null,
      },
    });
    return {
      payment,
      state: resolveEffectiveState(updated, new Date()),
    };
  });
}

/** Suspend a gym immediately, with a required reason. Data is preserved. */
export async function suspendOrganization(
  admin: PlatformAdminContext,
  input: { organizationId: string; reason: unknown },
): Promise<EffectiveSubscriptionState> {
  const reason = requireReasonableText(input.reason, "Reason", 280, true);
  if (!input.organizationId) {
    throw new PlatformAdminValidationError("Organization is required.");
  }
  return db.$transaction(async (tx) => {
    const subscription = await requireSubscriptionRow(tx, input.organizationId);
    const before = resolveEffectiveState(subscription, new Date());
    const updated = await tx.organizationSubscription.update({
      where: { id: subscription.id },
      data: {
        suspendedAt: new Date(),
        suspendedByClerkUserId: admin.clerkUserId,
        suspensionReason: reason,
      },
    });
    await writeAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: admin.userId,
      event: AUDIT_EVENT_SAAS_SUBSCRIPTION_SUSPENDED,
      targetType: "OrganizationSubscription",
      targetId: subscription.id,
      metadata: { beforeState: before, reason },
    });
    return resolveEffectiveState(updated, new Date());
  });
}

/**
 * Extend a trial by a validated number of days, with a required reason.
 * The extension applies from the later of now and the current expiry, so
 * extending a live trial pushes its existing expiry out, and extending
 * a non-suspended expired trial makes it live again from today.
 *
 * Suspension is NOT affected by an extension: extending a suspended
 * gym moves its trial window but leaves it SUSPENDED, because
 * suspension overrides any live trial or paid period. Restoring access
 * still requires an explicit reactivation (reactivateOrganization),
 * which clears the suspension — and, when no live entitlement remains
 * underneath it, requires a paid period in the same call. Do not read
 * "extends the trial" as "reactivates the gym".
 *
 * Only a gym that actually has a trial window can be extended —
 * otherwise the admin must grant a paid period instead.
 */
export async function extendTrial(
  admin: PlatformAdminContext,
  input: { organizationId: string; days: unknown; reason: unknown },
): Promise<{ trialEndsAt: Date; state: EffectiveSubscriptionState }> {
  const reason = requireReasonableText(input.reason, "Reason", 280, true);
  const daysValue =
    typeof input.days === "string" ? Number(input.days) : input.days;
  const days = typeof daysValue === "number" ? daysValue : NaN;
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    throw new PlatformAdminValidationError(
      "Extension must be a whole number of days between 1 and 90.",
    );
  }
  if (!input.organizationId) {
    throw new PlatformAdminValidationError("Organization is required.");
  }
  return db.$transaction(async (tx) => {
    const subscription = await requireSubscriptionRow(tx, input.organizationId);
    if (!subscription.trialEndsAt) {
      throw new PlatformAdminValidationError(
        "This gym has no trial window to extend. Grant a paid period instead.",
      );
    }
    const now = new Date();
    const base = Math.max(now.getTime(), subscription.trialEndsAt.getTime());
    const trialEndsAt = new Date(base + days * 24 * 60 * 60_000);
    const updated = await tx.organizationSubscription.update({
      where: { id: subscription.id },
      data: { trialEndsAt },
    });
    await writeAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: admin.userId,
      event: AUDIT_EVENT_SAAS_TRIAL_EXTENDED,
      targetType: "OrganizationSubscription",
      targetId: subscription.id,
      metadata: {
        days,
        reason,
        previousTrialEndsAt: subscription.trialEndsAt.toISOString(),
        newTrialEndsAt: trialEndsAt.toISOString(),
      },
    });
    return {
      trialEndsAt,
      state: resolveEffectiveState(updated, new Date()),
    };
  });
}

interface ValidatedReactivationPayment {
  amount: Prisma.Decimal;
  receivedAt: Date;
  periodStartAt: Date;
  periodEndAt: Date;
  reference: string | null;
  notes: string | null;
  idempotencyKey: string;
}

/**
 * Validate a reactivation payment payload. The idempotency key is
 * mandatory, under the same rule as the standalone payment form: a
 * payment stored without a key could never be deduplicated, and no
 * server-side fallback token is minted.
 */
function validateReactivationPayment(
  input: RecordPaymentInput,
): ValidatedReactivationPayment {
  const amount = parseMoneyAmount(input.amount);
  const receivedAt = parseCalendarDate(input.receivedAt, "Received date");
  const { periodStartAt, periodEndAt } = requirePeriod(
    parseCalendarDate(input.periodStartAt, "Period start"),
    parseCalendarDate(input.periodEndAt, "Period end"),
  );
  const reference = requireReasonableText(input.reference, "Reference", 200, false);
  const notes = requireReasonableText(input.notes, "Notes", 1000, false);
  const idempotencyKey =
    input.idempotencyKey === undefined || input.idempotencyKey === ""
      ? null
      : input.idempotencyKey;
  if (idempotencyKey === null) {
    throw new PlatformAdminValidationError(
      "Idempotency key is required. Resubmit from the reactivation form.",
    );
  }
  if (!isValidIdempotencyKey(idempotencyKey)) {
    throw new PlatformAdminValidationError("Invalid idempotency key.");
  }
  return {
    amount,
    receivedAt,
    periodStartAt,
    periodEndAt,
    reference,
    notes,
    idempotencyKey,
  };
}

/**
 * True when a stored SaaS payment is the same payment as a validated
 * reactivation payload: same money, same received date, same covered
 * period, same reference and notes. Amounts compare as Decimals (so
 * "3000" and "3000.00" are the same amount) and dates as instants.
 */
function isSameReactivationPayment(
  existing: SaasSubscriptionPayment,
  payment: ValidatedReactivationPayment,
): boolean {
  return (
    existing.amount.toString() === payment.amount.toString() &&
    existing.receivedAt.getTime() === payment.receivedAt.getTime() &&
    existing.periodStartAt.getTime() === payment.periodStartAt.getTime() &&
    existing.periodEndAt.getTime() === payment.periodEndAt.getTime() &&
    existing.reference === payment.reference &&
    existing.notes === payment.notes
  );
}

/** True when the error is a unique conflict on a payment idempotency key. */
function isIdempotencyKeyConflict(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    const target = (error.meta?.target as string[] | undefined) ?? [];
    return target.includes("idempotencyKey");
  }
  return false;
}

/**
 * Minimal read surface for token replay checks, satisfied by both the
 * shared Prisma client (fast path, before the transaction) and a
 * transaction client (authoritative recheck while holding the token
 * lock). Only the two reads the check needs are exposed.
 */
interface TokenReplayClient {
  saasSubscriptionPayment: {
    findFirst(args: {
      where: { idempotencyKey: string };
    }): Promise<SaasSubscriptionPayment | null>;
  };
  organizationSubscription: {
    findUnique(args: {
      where: { organizationId: string };
    }): Promise<OrganizationSubscription | null>;
  };
}

/**
 * Resolve a token replay/conflict for a reactivation payment.
 *
 * Returns the current effective state when the token was already
 * processed for this gym with the identical payload (graceful replay),
 * throws on cross-gym reuse, conflicting payload, or stale replay
 * after re-suspension, and returns null when the token is unused and
 * the caller should proceed. A token is looked up globally, not just
 * within this gym: tokens are minted per form render, so a token
 * already recorded anywhere else is a reuse.
 */
async function resolveTokenReplay(
  client: TokenReplayClient,
  organizationId: string,
  payment: ValidatedReactivationPayment,
): Promise<EffectiveSubscriptionState | null> {
  const existing = await client.saasSubscriptionPayment.findFirst({
    where: { idempotencyKey: payment.idempotencyKey },
  });
  if (!existing) return null;
  if (existing.organizationId !== organizationId) {
    throw new PlatformAdminValidationError(
      "This idempotency key was already used for another gym.",
    );
  }
  if (!isSameReactivationPayment(existing, payment)) {
    throw new PlatformAdminValidationError(
      "This idempotency key was already used with a different payment.",
    );
  }
  // Same token, same payload, same gym: this submission was already
  // processed, and its transaction necessarily cleared the
  // then-current suspension (payment + clearing commit atomically).
  // A suspension present now is therefore a new decision — replay
  // must not clear it — while an already-clear gym simply replays to
  // its current state.
  const current = await client.organizationSubscription.findUnique({
    where: { organizationId },
  });
  if (current?.suspendedAt) {
    throw new PlatformAdminValidationError(
      "This reactivation submission was already processed. Submit a new reactivation if the gym should be reactivated.",
    );
  }
  return resolveEffectiveState(current, new Date());
}

/**
 * Lift a suspension. When a valid underlying entitlement remains (live
 * trial or paid period), clearing the suspension is enough. Otherwise
 * the administrator must supply a paid period in the same call, which
 * is recorded as a payment and activated in the same transaction —
 * reactivation never silently revives an expired entitlement.
 *
 * Reactivation-with-payment idempotency (the same rule as the
 * standalone payment form, applied to this flow's own token):
 * - The token is mandatory when a payment is supplied; a missing,
 *   empty, or malformed token is rejected before anything is written.
 *   No server-side fallback token is minted.
 * - A retry carrying the same token and the same payment payload
 *   replays to the current state without creating a second payment —
 *   including concurrent retries. Same-token attempts serialize on a
 *   transaction-scoped advisory lock keyed by the token (no migration:
 *   the lock is the same convention the trial-claim path uses), and
 *   the global token recheck inside the transaction — after the lock
 *   is held — is authoritative, so a concurrent same-token attempt
 *   for a different gym is rejected instead of recording a second
 *   payment. The (organizationId, idempotencyKey) unique constraint
 *   and the P2002 path remain as a backstop for races through flows
 *   that do not take this lock.
 * - Reusing a token with a different organization or a different
 *   payment payload is rejected as a conflict, never recorded.
 * - A replay never clears a fresh suspension: the payment and the
 *   suspension-clearing update commit atomically, so a payment row
 *   from an earlier submission implies its suspension was already
 *   cleared — a suspension present now is a new decision, and a stale
 *   resubmission must not override it.
 *
 * Reactivation stays explicit and distinct from trial extension:
 * extending a trial never clears a suspension, and clearing one never
 * extends anything — it only removes the suspension, plus the paid
 * period when one is supplied and no valid entitlement remains.
 */
export async function reactivateOrganization(
  admin: PlatformAdminContext,
  input: {
    organizationId: string;
    reason: unknown;
    payment?: RecordPaymentInput | null;
  },
): Promise<EffectiveSubscriptionState> {
  const reason = requireReasonableText(input.reason, "Reason", 280, true);
  if (!input.organizationId) {
    throw new PlatformAdminValidationError("Organization is required.");
  }

  // Validate a supplied payment up front, before any database write,
  // so the replay/conflict checks below compare normalized values and
  // a malformed submission fails without touching the subscription.
  // One safe-direction change rides along: a submission that checks
  // the payment box with malformed fields used to have its payment
  // silently ignored when a valid entitlement remained; it now fails
  // validation instead of clearing the suspension on bad data. A
  // submission without a payment is unaffected.
  const payment = input.payment
    ? validateReactivationPayment(input.payment)
    : null;

  // Fast-path replay / conflict check (plain reads, no mutation).
  // The authoritative check runs again inside the transaction while
  // holding the token lock, which is what closes the concurrent
  // cross-gym race; this check only avoids opening a transaction for
  // the already-decided cases.
  if (payment) {
    const replayed = await resolveTokenReplay(
      db,
      input.organizationId,
      payment,
    );
    if (replayed !== null) return replayed;
  }

  try {
    return await db.$transaction(async (tx) => {
      if (payment) {
        // Serialize every reactivation attempt carrying this token —
        // including attempts for different gyms — so the global
        // recheck below observes a stable picture. The lock is
        // transaction-scoped: it releases on commit or rollback, so a
        // failed holder never blocks the next attempt. A hashtext
        // collision between different tokens can only cause
        // unnecessary waiting, never a wrong result, because the
        // recheck compares the exact key string.
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${"saas-reactivation-token:" + payment.idempotencyKey}))
        `;
        // Authoritative recheck while holding the lock: a concurrent
        // same-token transaction has committed or rolled back by now,
        // so this read sees its payment if it recorded one.
        const replayed = await resolveTokenReplay(
          tx,
          input.organizationId,
          payment,
        );
        if (replayed !== null) return replayed;
      }
      const subscription = await requireSubscriptionRow(tx, input.organizationId);
      if (!subscription.suspendedAt) {
        throw new PlatformAdminValidationError(
          "This gym is not suspended, so there is nothing to reactivate.",
        );
      }
      const underlying = resolveEffectiveState(
        { ...subscription, suspendedAt: null },
        new Date(),
      );
      const hasValidEntitlement =
        underlying === "TRIAL_ACTIVE" || underlying === "ACTIVE";

      if (!hasValidEntitlement) {
        if (!payment) {
          throw new PlatformAdminValidationError(
            "No valid trial or paid period remains. Provide a paid period to reactivate.",
          );
        }
        const created = await tx.saasSubscriptionPayment.create({
          data: {
            organizationId: input.organizationId,
            subscriptionId: subscription.id,
            amount: payment.amount,
            receivedAt: payment.receivedAt,
            reference: payment.reference,
            periodStartAt: payment.periodStartAt,
            periodEndAt: payment.periodEndAt,
            recordedByClerkUserId: admin.clerkUserId,
            notes: payment.notes,
            idempotencyKey: payment.idempotencyKey,
          },
        });
        await tx.organizationSubscription.update({
          where: { id: subscription.id },
          data: {
            paidPeriodStartAt: payment.periodStartAt,
            paidPeriodEndAt: payment.periodEndAt,
            paidThroughAt: payment.periodEndAt,
          },
        });
        await writeAuditEvent(tx, {
          organizationId: input.organizationId,
          actorUserId: admin.userId,
          event: AUDIT_EVENT_SAAS_PAYMENT_RECORDED,
          targetType: "SaasSubscriptionPayment",
          targetId: created.id,
          metadata: {
            amount: payment.amount.toString(),
            periodStartAt: payment.periodStartAt.toISOString(),
            periodEndAt: payment.periodEndAt.toISOString(),
            duringReactivation: true,
          },
        });
      }

      const updated = await tx.organizationSubscription.update({
        where: { id: subscription.id },
        data: {
          suspendedAt: null,
          suspendedByClerkUserId: null,
          suspensionReason: null,
        },
      });
      await writeAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: admin.userId,
        event: AUDIT_EVENT_SAAS_SUBSCRIPTION_REACTIVATED,
        targetType: "OrganizationSubscription",
        targetId: subscription.id,
        metadata: { reason, grantedPaidPeriod: !hasValidEntitlement },
      });
      return resolveEffectiveState(updated, new Date());
    });
  } catch (error) {
    // Concurrent duplicate through a path that does not take the
    // token lock (e.g. the standalone payment form racing this flow
    // on the same key): a unique violation is only raised once the
    // winning transaction has committed, so re-reading finds its
    // payment. A matching payload replays to the current state; a
    // conflicting payload is rejected.
    if (payment && isIdempotencyKeyConflict(error)) {
      const replayed = await resolveTokenReplay(
        db,
        input.organizationId,
        payment,
      );
      if (replayed !== null) return replayed;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Offer decisions (platform admin) and owner offer actions
// ---------------------------------------------------------------------------

export type OfferDecision = "APPROVED" | "DECLINED";

/**
 * Decide a pending offer request. The decision is a conditional update
 * (only a still-REQUESTED row moves), so two concurrent decisions
 * cannot both succeed. Only 5% or 10% may be approved.
 */
export async function reviewOffer(
  admin: PlatformAdminContext,
  input: {
    offerId: string;
    decision: OfferDecision;
    discountPercent?: unknown;
    offerExpiresAt?: unknown;
    applicablePeriodStartAt?: unknown;
    applicablePeriodEndAt?: unknown;
    agreedAmount?: unknown;
    notes?: unknown;
  },
): Promise<SaasOfferRequest> {
  if (input.decision !== "APPROVED" && input.decision !== "DECLINED") {
    throw new PlatformAdminValidationError("Decision must be APPROVED or DECLINED.");
  }
  let discountPercent: number | null = null;
  let offerExpiresAt: Date | null = null;
  let applicablePeriodStartAt: Date | null = null;
  let applicablePeriodEndAt: Date | null = null;
  let agreedAmount: Prisma.Decimal | null = null;
  if (input.decision === "APPROVED") {
    const percent =
      typeof input.discountPercent === "string"
        ? Number(input.discountPercent)
        : input.discountPercent;
    if (percent !== 5 && percent !== 10) {
      throw new PlatformAdminValidationError(
        "Approved discount must be 5% or 10%.",
      );
    }
    discountPercent = percent;
    if (input.offerExpiresAt !== undefined && input.offerExpiresAt !== "") {
      offerExpiresAt = parseCalendarDate(input.offerExpiresAt, "Offer expiry");
      if (offerExpiresAt.getTime() <= Date.now()) {
        throw new PlatformAdminValidationError(
          "Offer expiry must be in the future.",
        );
      }
    }
    if (
      input.applicablePeriodStartAt !== undefined &&
      input.applicablePeriodStartAt !== "" &&
      input.applicablePeriodEndAt !== undefined &&
      input.applicablePeriodEndAt !== ""
    ) {
      const period = requirePeriod(
        parseCalendarDate(input.applicablePeriodStartAt, "Applicable period start"),
        parseCalendarDate(input.applicablePeriodEndAt, "Applicable period end"),
      );
      applicablePeriodStartAt = period.periodStartAt;
      applicablePeriodEndAt = period.periodEndAt;
    }
    if (input.agreedAmount !== undefined && input.agreedAmount !== "") {
      agreedAmount = parseMoneyAmount(input.agreedAmount);
    }
  }
  const notes = requireReasonableText(input.notes, "Notes", 1000, false);

  return db.$transaction(async (tx) => {
    const updated = await tx.saasOfferRequest.updateMany({
      where: { id: input.offerId, status: "REQUESTED" },
      data: {
        status: input.decision,
        discountPercent,
        offerExpiresAt,
        applicablePeriodStartAt,
        applicablePeriodEndAt,
        agreedAmount,
        decidedByClerkUserId: admin.clerkUserId,
        decidedAt: new Date(),
        notes,
      },
    });
    if (updated.count !== 1) {
      throw new PlatformAdminValidationError(
        "This offer is no longer awaiting a decision.",
      );
    }
    const offer = await tx.saasOfferRequest.findUniqueOrThrow({
      where: { id: input.offerId },
    });
    await writeAuditEvent(tx, {
      organizationId: offer.organizationId,
      actorUserId: admin.userId,
      event:
        input.decision === "APPROVED"
          ? AUDIT_EVENT_SAAS_OFFER_APPROVED
          : AUDIT_EVENT_SAAS_OFFER_DECLINED,
      targetType: "SaasOfferRequest",
      targetId: offer.id,
      metadata: {
        discountPercent,
        offerExpiresAt: offerExpiresAt?.toISOString() ?? null,
        agreedAmount: agreedAmount?.toString() ?? null,
      },
    });
    return offer;
  });
}

/**
 * Owner submits an offer request. Allowed only while the trial is live,
 * inside the final-48-hour window, and the gym is not suspended.
 * Idempotent: when a REQUESTED row already exists it is returned
 * unchanged — repeated clicks never create duplicates (the partial
 * unique index is the backstop; a P2002 here resolves to the existing
 * row instead of an error).
 */
export async function requestSaasOffer(
  organizationId: string,
  actorUserId: string,
): Promise<{ offer: SaasOfferRequest; alreadyRequested: boolean }> {
  return db.$transaction(async (tx) => {
    const subscription = await tx.organizationSubscription.findUnique({
      where: { organizationId },
    });
    // Explicit suspension check, not just the window check below: a
    // suspended gym's trial window can still be inside its final 48
    // hours, and that must never read as offer-eligible.
    if (subscription?.suspendedAt) {
      throw new PlatformAdminValidationError(
        "Offers cannot be requested while the gym is suspended.",
      );
    }
    if (!isInOfferWindow(subscription, new Date())) {
      throw new PlatformAdminValidationError(
        "Offers can only be requested during the final 48 hours of an active trial.",
      );
    }
    const existing = await tx.saasOfferRequest.findFirst({
      where: { organizationId, status: "REQUESTED" },
      orderBy: { requestedAt: "asc" },
    });
    if (existing) {
      return { offer: existing, alreadyRequested: true };
    }
    try {
      const offer = await tx.saasOfferRequest.create({
        data: { organizationId },
      });
      await writeAuditEvent(tx, {
        organizationId,
        actorUserId,
        event: AUDIT_EVENT_SAAS_OFFER_REQUESTED,
        targetType: "SaasOfferRequest",
        targetId: offer.id,
        metadata: {},
      });
      return { offer, alreadyRequested: false };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const raced = await tx.saasOfferRequest.findFirst({
          where: { organizationId, status: "REQUESTED" },
          orderBy: { requestedAt: "asc" },
        });
        if (raced) return { offer: raced, alreadyRequested: true };
      }
      throw error;
    }
  });
}

/** Owner accepts an approved offer before its expiry. */
export async function acceptSaasOffer(
  organizationId: string,
  actorUserId: string,
  offerId: string,
): Promise<SaasOfferRequest> {
  return db.$transaction(async (tx) => {
    const updated = await tx.saasOfferRequest.updateMany({
      where: {
        id: offerId,
        organizationId,
        status: "APPROVED",
        OR: [
          { offerExpiresAt: null },
          { offerExpiresAt: { gt: new Date() } },
        ],
      },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });
    if (updated.count !== 1) {
      throw new PlatformAdminValidationError(
        "This offer can no longer be accepted.",
      );
    }
    const offer = await tx.saasOfferRequest.findUniqueOrThrow({
      where: { id: offerId },
    });
    await writeAuditEvent(tx, {
      organizationId,
      actorUserId,
      event: AUDIT_EVENT_SAAS_OFFER_ACCEPTED,
      targetType: "SaasOfferRequest",
      targetId: offer.id,
      metadata: { discountPercent: offer.discountPercent },
    });
    return offer;
  });
}

/** Owner dismisses the final-48-hour prompt (prompt only, not the offer). */
export async function dismissOfferPrompt(organizationId: string): Promise<void> {
  await db.organizationSubscription.upsert({
    where: { organizationId },
    update: { offerPromptDismissedAt: new Date() },
    create: { organizationId, offerPromptDismissedAt: new Date() },
  });
}
