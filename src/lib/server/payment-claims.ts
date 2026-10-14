import "server-only";

import { Prisma, type PaymentClaimStatus, type Role } from "@prisma/client";

import {
  deriveMembershipPayments,
  deriveMembershipStatus,
  derivePaymentStatus,
  PaymentValidationError,
  validatePaymentInput,
  type MembershipPlan,
  type MembershipStatus,
  type PaymentInput,
  type PaymentMethod,
  type PaymentStatus,
} from "../members";
import { getPrimaryMembership } from "./authorization";
import { isValidIdempotencyKey } from "../idempotency";
import {
  AUDIT_EVENT_PAYMENT_CLAIM_CONFIRMED,
  AUDIT_EVENT_PAYMENT_CLAIM_REJECTED,
  AUDIT_EVENT_PAYMENT_CLAIM_SUBMITTED,
  AUDIT_EVENT_PAYMENT_CONFIRMED,
  writeAuditEvent,
} from "./audit";
import { db } from "./db";
import type { MemberSessionContext } from "./member-session";
import { canRecordPayment, sumConfirmedPaymentsByMembership } from "./payments";

/**
 * Server-side payment claims service (04-DATABASE-DESIGN §13;
 * docs/05-AUTHORIZATION.md §8).
 *
 * A claim is a member saying "I have paid". It is NOT a payment: claims
 * never enter paid/outstanding calculations, which derive only from
 * Payment rows (see payments.ts). An authorized staff user verifies a
 * claim against money actually received — confirmation creates the
 * one linked Payment; rejection closes the claim. Deciding a claim
 * never modifies the membership: payment and renewal are separate.
 *
 * Authorization:
 * - Submit/list-own: a member scope resolved from a verified member
 *   session (user + organization + linked Member). The session is the
 *   only legitimate source of that scope — the client never supplies
 *   organization, member or membership IDs. (A member may belong to
 *   several gyms, so unlike the staff services this scope cannot be
 *   re-derived from the user ID alone; the service still re-checks
 *   that the Member row belongs to the scoped organization.)
 * - Verify (list pending / confirm / reject): staff of the gym, using
 *   the same role rule as recording a confirmed payment — OWNER,
 *   ADMIN, STAFF (see canVerifyPaymentClaim). The organization always
 *   comes from the actor's own primary membership, never from input,
 *   so a claim from another gym is indistinguishable from a missing
 *   one.
 *
 * Concurrency (ADR 013 — constraints and locks, not prechecks):
 * - Exact duplicate PENDING claims are impossible: a partial unique
 *   index (migration-only, see schema) rejects them; the in-service
 *   pre-check only produces the friendly error first, and a P2002
 *   from the index is mapped to the same error.
 * - The pending cap (MAX_PENDING_CLAIMS_PER_MEMBERSHIP) is enforced
 *   while holding a row lock on the membership inside the submission
 *   transaction, so concurrent submissions serialize per membership
 *   and cannot race past the count.
 * - Confirmation/rejection transition the claim with a conditional
 *   update that only matches a still-PENDING row; the loser of a race
 *   gets a conflict and creates nothing. The unique
 *   payments.payment_claim_id link is the second lock.
 * - The verifier's authority is revalidated inside the decision
 *   transaction under a lock on their own membership row (the staff
 *   service pattern), so a demotion or removal that lands mid-request
 *   cannot still decide a claim.
 */

/** Maximum number of undecided claims a member may hold per membership. */
export const MAX_PENDING_CLAIMS_PER_MEMBERSHIP = 3;

/** Thrown when the caller lacks permission or the tenant scope fails. */
export class PaymentClaimAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentClaimAuthorizationError";
  }
}

/** Thrown when the member/membership/claim cannot be found in scope. */
export class PaymentClaimNotFoundError extends Error {
  constructor(message = "Payment claim not found.") {
    super(message);
    this.name = "PaymentClaimNotFoundError";
  }
}

/** Thrown when a claim has already been decided (confirm/reject race). */
export class PaymentClaimConflictError extends Error {
  constructor(message = "This claim has already been decided.") {
    super(message);
    this.name = "PaymentClaimConflictError";
  }
}

/**
 * Thrown when a claim-confirmation idempotency token was already used
 * for a different operation (H4). Same token + same claim + same
 * amount resolves to the original payment instead.
 */
export class PaymentClaimIdempotencyConflictError extends Error {
  constructor(
    message = "This confirmation was already used with different details.",
  ) {
    super(message);
    this.name = "PaymentClaimIdempotencyConflictError";
  }
}

/** Thrown when an identical claim is already pending for the membership. */
export class PaymentClaimDuplicateError extends Error {
  constructor(
    message = "You already have a pending claim with the same amount, method and reference.",
  ) {
    super(message);
    this.name = "PaymentClaimDuplicateError";
  }
}

/** Thrown when the membership already has the maximum pending claims. */
export class PaymentClaimLimitError extends Error {
  constructor(
    message = "You already have the maximum number of pending claims for this membership. Please wait for the gym to verify them.",
  ) {
    super(message);
    this.name = "PaymentClaimLimitError";
  }
}

/** Roles allowed to verify payment claims: the confirmed-payment rule. */
export function canVerifyPaymentClaim(role: Role): boolean {
  return canRecordPayment(role);
}

/**
 * The member-side scope, resolved from a verified member session:
 * the authenticated user, the session's gym, and the Member record
 * linked to that user in that gym.
 */
export interface MemberClaimScope {
  userId: string;
  organizationId: string;
  memberId: string;
}

/**
 * Translate a resolved member session context into a claim scope —
 * the single place this security-sensitive mapping lives. Identity
 * comes only from the server-side session chain (ADR 021): the user,
 * the session's organization, and the Member record linked to that
 * user in that gym. A session without a linked Member record has no
 * claim scope.
 */
export function memberClaimScope(
  context: MemberSessionContext,
): MemberClaimScope {
  if (!context.member) {
    throw new PaymentClaimAuthorizationError(
      "This session is not linked to a member record.",
    );
  }
  return {
    userId: context.user.id,
    organizationId: context.organization.id,
    memberId: context.member.id,
  };
}

interface StaffScope {
  userId: string;
  organizationId: string;
  role: Role;
}

/** Staff scope from the actor's own primary membership (never input). */
async function resolveStaffScope(userId: string): Promise<StaffScope> {
  if (!userId) {
    throw new PaymentClaimAuthorizationError("Authentication is required.");
  }
  const membership = await getPrimaryMembership(userId);
  if (!membership) {
    throw new PaymentClaimAuthorizationError(
      "You do not belong to an organization.",
    );
  }
  return {
    userId,
    organizationId: membership.organizationId,
    role: membership.role,
  };
}

async function requireVerifyScope(userId: string): Promise<StaffScope> {
  const scope = await resolveStaffScope(userId);
  if (!canVerifyPaymentClaim(scope.role)) {
    throw new PaymentClaimAuthorizationError(
      "You do not have permission to verify payment claims.",
    );
  }
  return scope;
}

interface LockedVerifierMembership {
  organizationId: string;
  role: Role;
}

/**
 * Re-derive the verifier's authority inside the decision transaction,
 * under a lock on their own membership row (the staff.ts
 * revalidateActorInTransaction pattern). requireVerifyScope's earlier
 * check is only a fast path: between it and this transaction the actor
 * may have been demoted or removed, and a revoked actor must not be
 * able to decide a claim. The lock also serializes against the
 * revocation itself — deleting the membership needs this row — so the
 * two linearize instead of racing: if the decision wins the lock it
 * was authorized at its commit point; if the revocation committed
 * first, the locked read finds no (or a demoted) row and denies.
 *
 * The row selected is exactly resolveStaffScope's: the actor's
 * earliest organization membership (getPrimaryMembership's ordering).
 */
async function revalidateVerifierInTransaction(
  tx: Prisma.TransactionClient,
  scope: StaffScope,
): Promise<void> {
  const rows = await tx.$queryRaw<LockedVerifierMembership[]>`
    SELECT organization_id AS "organizationId", role
    FROM organization_memberships
    WHERE user_id = ${scope.userId}
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE
  `;
  const current = rows[0];
  if (!current || current.organizationId !== scope.organizationId) {
    throw new PaymentClaimAuthorizationError(
      "Your access changed while you were working. Refresh and try again.",
    );
  }
  if (!canVerifyPaymentClaim(current.role)) {
    throw new PaymentClaimAuthorizationError(
      "You do not have permission to verify payment claims.",
    );
  }
}

/** Prisma.Decimal → integer paise (exact; Decimal mul is not floating point). */
function decimalToPaise(value: Prisma.Decimal): number {
  return value.mul(100).toNumber();
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export interface PaymentClaimView {
  id: string;
  memberId: string;
  membershipId: string;
  /** What the member says they paid, in paise. Never a balance input. */
  claimedAmountPaise: number;
  paymentMethod: PaymentMethod;
  reference: string | null;
  status: PaymentClaimStatus;
  submittedAt: string;
  /** When the claim was decided (confirm or reject), if it has been. */
  verifiedAt: string | null;
  /** The confirmed payment's ID and amount, once confirmed. */
  paymentId: string | null;
  confirmedAmountPaise: number | null;
}

type ClaimRow = Prisma.PaymentClaimGetPayload<{
  include: { payment: { select: { id: true; amount: true } } };
}>;

function toClaimView(row: ClaimRow): PaymentClaimView {
  return {
    id: row.id,
    memberId: row.memberId,
    membershipId: row.membershipId,
    claimedAmountPaise: decimalToPaise(row.claimedAmount),
    paymentMethod: row.paymentMethod,
    reference: row.reference,
    status: row.status,
    submittedAt: row.createdAt.toISOString(),
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    paymentId: row.payment?.id ?? null,
    confirmedAmountPaise: row.payment
      ? decimalToPaise(row.payment.amount)
      : null,
  };
}

const CLAIM_INCLUDE = {
  payment: { select: { id: true, amount: true } },
} as const;

/**
 * Submit a claim against the member's latest membership in the scoped
 * gym. The membership is resolved server-side (the member never picks
 * one), exactly as staff payment recording resolves it.
 */
export async function submitPaymentClaim(
  scope: MemberClaimScope,
  input: PaymentInput,
): Promise<{ claimId: string }> {
  if (!scope.userId || !scope.organizationId || !scope.memberId) {
    throw new PaymentClaimAuthorizationError("Authentication is required.");
  }
  const validated = validatePaymentInput(input);

  const member = await db.member.findFirst({
    where: { id: scope.memberId, organizationId: scope.organizationId },
    select: { id: true },
  });
  if (!member) {
    throw new PaymentClaimNotFoundError("Member not found.");
  }

  const membership = await db.membership.findFirst({
    where: { memberId: member.id, organizationId: scope.organizationId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!membership) {
    throw new PaymentClaimNotFoundError(
      "This member has no membership to pay against.",
    );
  }

  const claimedAmount = new Prisma.Decimal(validated.amountPaise).div(100);

  try {
    const claimId = await db.$transaction(async (tx) => {
      // Serialize submissions per membership: lock the membership row
      // so the pending count and duplicate check below cannot be raced
      // by a concurrent submission for the same membership.
      await tx.$queryRaw`
        SELECT "id" FROM "memberships" WHERE "id" = ${membership.id} FOR UPDATE
      `;

      const pending = await tx.paymentClaim.findMany({
        where: { membershipId: membership.id, status: "PENDING" },
        select: {
          claimedAmount: true,
          paymentMethod: true,
          reference: true,
        },
      });
      const duplicate = pending.some(
        (claim) =>
          claim.claimedAmount.equals(claimedAmount) &&
          claim.paymentMethod === validated.paymentMethod &&
          claim.reference === validated.reference,
      );
      if (duplicate) {
        throw new PaymentClaimDuplicateError();
      }
      if (pending.length >= MAX_PENDING_CLAIMS_PER_MEMBERSHIP) {
        throw new PaymentClaimLimitError();
      }

      const claim = await tx.paymentClaim.create({
        data: {
          organizationId: scope.organizationId,
          memberId: member.id,
          membershipId: membership.id,
          claimedAmount,
          paymentMethod: validated.paymentMethod,
          reference: validated.reference,
        },
        select: { id: true },
      });
      await writeAuditEvent(tx, {
        organizationId: scope.organizationId,
        actorUserId: scope.userId,
        event: AUDIT_EVENT_PAYMENT_CLAIM_SUBMITTED,
        targetType: "PaymentClaim",
        targetId: claim.id,
        metadata: {
          memberId: member.id,
          membershipId: membership.id,
          claimedAmountPaise: validated.amountPaise,
          paymentMethod: validated.paymentMethod,
          reference: validated.reference,
        },
      });
      return claim.id;
    });
    return { claimId };
  } catch (error) {
    // The partial unique index fired despite the pre-check (a true
    // race): same outcome for the caller — the claim already exists.
    if (isUniqueViolation(error)) {
      throw new PaymentClaimDuplicateError();
    }
    throw error;
  }
}

/** The member's own claims in the scoped gym, newest first. */
export async function listOwnPaymentClaims(
  scope: MemberClaimScope,
): Promise<PaymentClaimView[]> {
  if (!scope.userId || !scope.organizationId || !scope.memberId) {
    throw new PaymentClaimAuthorizationError("Authentication is required.");
  }
  const rows = await db.paymentClaim.findMany({
    where: {
      organizationId: scope.organizationId,
      memberId: scope.memberId,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: CLAIM_INCLUDE,
  });
  return rows.map(toClaimView);
}

/** The member's own current-membership balance view (member surface). */
export interface OwnMembershipSummary {
  membershipId: string;
  plan: MembershipPlan;
  startDate: string;
  expiryDate: string;
  membershipStatus: MembershipStatus;
  feePaise: number;
  paidPaise: number;
  outstandingPaise: number;
  paymentStatus: PaymentStatus;
}

/**
 * The scoped member's latest membership with its derived balance —
 * the same derivation the staff views use (fee vs SUM of confirmed
 * payments; claims never counted). Returns null when the member has
 * no membership in the scoped gym. Tenant safety is structural: the
 * membership lookup is pinned to the scope's organization AND member,
 * and the payment sum is organization-pinned by the ledger helper.
 */
export async function getOwnMembershipSummary(
  scope: MemberClaimScope,
): Promise<OwnMembershipSummary | null> {
  if (!scope.userId || !scope.organizationId || !scope.memberId) {
    throw new PaymentClaimAuthorizationError("Authentication is required.");
  }
  const membership = await db.membership.findFirst({
    where: {
      organizationId: scope.organizationId,
      memberId: scope.memberId,
    },
    orderBy: { createdAt: "desc" },
  });
  if (!membership) {
    return null;
  }
  const sums = await sumConfirmedPaymentsByMembership(scope.organizationId, [
    membership.id,
  ]);
  const feePaise = membership.fee.mul(100).toNumber();
  const paidPaise = sums.get(membership.id) ?? 0;
  const { outstandingPaise } = deriveMembershipPayments(feePaise, paidPaise);
  return {
    membershipId: membership.id,
    plan: membership.plan,
    startDate: membership.startDate.toISOString(),
    expiryDate: membership.expiryDate.toISOString(),
    membershipStatus: deriveMembershipStatus(membership.expiryDate),
    feePaise,
    paidPaise,
    outstandingPaise,
    paymentStatus: derivePaymentStatus(feePaise, paidPaise),
  };
}

/** The gym's undecided claims, oldest first — the verification queue. */
export async function listPendingClaimsForOrganization(
  staffUserId: string,
): Promise<PaymentClaimView[]> {
  const scope = await requireVerifyScope(staffUserId);
  const rows = await db.paymentClaim.findMany({
    where: { organizationId: scope.organizationId, status: "PENDING" },
    orderBy: { createdAt: "asc" },
    include: CLAIM_INCLUDE,
  });
  return rows.map(toClaimView);
}

const CLAIM_REVIEW_INCLUDE = {
  payment: { select: { id: true, amount: true } },
  member: { select: { name: true, phoneNumber: true } },
  membership: { select: { plan: true, fee: true, expiryDate: true } },
} as const;

/** A pending claim with the display and balance context staff review against. */
export interface PendingClaimReviewView extends PaymentClaimView {
  memberName: string;
  memberPhoneNumber: string;
  membershipPlan: MembershipPlan;
  membershipFeePaise: number;
  membershipExpiryDate: string;
  /** Confirmed payments only — the pending claim itself never counts. */
  paidPaise: number;
  outstandingPaise: number;
}

/**
 * The gym's verification queue with member/membership display fields
 * and per-membership balance context (C3-S1). Same authorization and
 * primary-gym scope as listPendingClaimsForOrganization; balances come
 * from one grouped sum over confirmed payments for the queued
 * memberships — no per-claim queries, and pending claims are never
 * included in the paid totals. The linked member and membership rows
 * are guaranteed by the claims' composite foreign keys (a claim
 * cannot exist without them, and no flow deletes members or
 * memberships), so the include always resolves inside the claim's
 * own organization.
 */
export async function listPendingClaimsForReview(
  staffUserId: string,
): Promise<PendingClaimReviewView[]> {
  const scope = await requireVerifyScope(staffUserId);
  const rows = await db.paymentClaim.findMany({
    where: { organizationId: scope.organizationId, status: "PENDING" },
    orderBy: { createdAt: "asc" },
    include: CLAIM_REVIEW_INCLUDE,
  });
  const membershipIds = [...new Set(rows.map((row) => row.membershipId))];
  const sums = await sumConfirmedPaymentsByMembership(
    scope.organizationId,
    membershipIds,
  );
  return rows.map((row) => {
    const membershipFeePaise = decimalToPaise(row.membership.fee);
    const paidPaise = sums.get(row.membershipId) ?? 0;
    const { outstandingPaise } = deriveMembershipPayments(
      membershipFeePaise,
      paidPaise,
    );
    return {
      ...toClaimView(row),
      memberName: row.member.name,
      memberPhoneNumber: row.member.phoneNumber,
      membershipPlan: row.membership.plan,
      membershipFeePaise,
      membershipExpiryDate: row.membership.expiryDate.toISOString(),
      paidPaise,
      outstandingPaise,
    };
  });
}

/**
 * One member's claim history for staff (all statuses, newest first).
 * The member is re-verified inside the actor's scoped organization;
 * a foreign or nonexistent member produces the same not-found error,
 * so the read is not an oracle for other gyms' rosters.
 */
export async function listClaimsForMember(
  staffUserId: string,
  memberId: string,
): Promise<PaymentClaimView[]> {
  const scope = await requireVerifyScope(staffUserId);
  const member = await db.member.findFirst({
    where: { id: memberId, organizationId: scope.organizationId },
    select: { id: true },
  });
  if (!member) {
    throw new PaymentClaimNotFoundError("Member not found.");
  }
  const rows = await db.paymentClaim.findMany({
    where: { organizationId: scope.organizationId, memberId: member.id },
    orderBy: { createdAt: "desc" },
    include: CLAIM_INCLUDE,
  });
  return rows.map(toClaimView);
}

async function findClaimInScope(organizationId: string, claimId: string) {
  const claim = await db.paymentClaim.findFirst({
    where: { id: claimId, organizationId },
    select: {
      id: true,
      memberId: true,
      membershipId: true,
      claimedAmount: true,
      paymentMethod: true,
      reference: true,
      status: true,
    },
  });
  if (!claim) {
    throw new PaymentClaimNotFoundError();
  }
  return claim;
}

/**
 * Confirm a claim: the claim transitions to CONFIRMED and the single
 * linked Payment is created, atomically, with both audit events. The
 * confirmed amount defaults to the claimed amount; staff may confirm
 * the different amount actually received (a smaller confirmation is
 * simply a partial payment — the balance keeps deriving from the
 * Payment rows alone).
 */
interface ClaimPaymentRow {
  id: string;
  amount: Prisma.Decimal;
  paymentClaimId: string | null;
  idempotencyKey: string | null;
}

async function findPaymentByIdempotencyKey(
  organizationId: string,
  idempotencyKey: string,
): Promise<ClaimPaymentRow | null> {
  return db.payment.findUnique({
    where: {
      organizationId_idempotencyKey: { organizationId, idempotencyKey },
    },
    select: { id: true, amount: true, paymentClaimId: true, idempotencyKey: true },
  });
}

/**
 * Whether a stored payment is exactly the confirmation now being
 * retried: it must be THIS claim's payment for the same effective
 * amount. (Method and reference come from the claim itself, so they
 * cannot differ for the same claim.)
 */
function isSameConfirmation(
  existing: ClaimPaymentRow,
  claimId: string,
  confirmedAmountPaise: number,
): boolean {
  return (
    existing.paymentClaimId === claimId &&
    decimalToPaise(existing.amount) === confirmedAmountPaise
  );
}

export async function confirmPaymentClaim(
  staffUserId: string,
  claimId: string,
  input?: { amount?: string; idempotencyKey?: string },
): Promise<{ claimId: string; paymentId: string; deduplicated?: boolean }> {
  const scope = await requireVerifyScope(staffUserId);
  const claim = await findClaimInScope(scope.organizationId, claimId);

  const claimedAmountPaise = decimalToPaise(claim.claimedAmount);
  let confirmedAmountPaise = claimedAmountPaise;
  if (input?.amount !== undefined) {
    confirmedAmountPaise = validatePaymentInput({
      amount: input.amount,
      paymentMethod: claim.paymentMethod,
      reference: claim.reference ?? "",
    }).amountPaise;
  }

  const idempotencyKey = input?.idempotencyKey;
  if (idempotencyKey !== undefined && !isValidIdempotencyKey(idempotencyKey)) {
    throw new PaymentValidationError({
      form: "This confirmation could not be verified. Refresh the page and try again.",
    });
  }

  if (idempotencyKey) {
    const existing = await findPaymentByIdempotencyKey(
      scope.organizationId,
      idempotencyKey,
    );
    if (existing) {
      if (isSameConfirmation(existing, claim.id, confirmedAmountPaise)) {
        return { claimId: claim.id, paymentId: existing.id, deduplicated: true };
      }
      throw new PaymentClaimIdempotencyConflictError();
    }
  }

  const now = new Date();

  try {
    const result = await db.$transaction(async (tx) => {
      // Revalidate the verifier under lock before any mutation: a
      // demoted/removed actor must not decide, even mid-request.
      await revalidateVerifierInTransaction(tx, scope);
      // Claim the decision atomically: only a still-PENDING claim
      // transitions, so two staff racing to decide cannot both win.
      const transition = await tx.paymentClaim.updateMany({
        where: {
          id: claim.id,
          organizationId: scope.organizationId,
          status: "PENDING",
        },
        data: { status: "CONFIRMED", verifiedAt: now, verifiedBy: scope.userId },
      });
      if (transition.count === 0) {
        if (idempotencyKey) {
          // A racing submission carrying the same token may already
          // have decided this claim: resolve to its payment when it is
          // exactly this confirmation. A same-token payment for a
          // different amount is an idempotency conflict; a decision by
          // a different operation keeps the already-decided outcome.
          const winner = await tx.payment.findFirst({
            where: {
              organizationId: scope.organizationId,
              paymentClaimId: claim.id,
            },
            select: {
              id: true,
              amount: true,
              paymentClaimId: true,
              idempotencyKey: true,
            },
          });
          if (winner && winner.idempotencyKey === idempotencyKey) {
            if (isSameConfirmation(winner, claim.id, confirmedAmountPaise)) {
              return { paymentId: winner.id, deduplicated: true as const };
            }
            throw new PaymentClaimIdempotencyConflictError();
          }
        }
        throw new PaymentClaimConflictError();
      }

      const payment = await tx.payment.create({
        data: {
          organizationId: scope.organizationId,
          memberId: claim.memberId,
          membershipId: claim.membershipId,
          // Exact Decimal from integer paise — no floating point.
          amount: new Prisma.Decimal(confirmedAmountPaise).div(100),
          paymentMethod: claim.paymentMethod,
          reference: claim.reference,
          confirmedAt: now,
          confirmedBy: scope.userId,
          paymentClaimId: claim.id,
          idempotencyKey: idempotencyKey ?? null,
        },
        select: { id: true },
      });
      await writeAuditEvent(tx, {
        organizationId: scope.organizationId,
        actorUserId: scope.userId,
        event: AUDIT_EVENT_PAYMENT_CLAIM_CONFIRMED,
        targetType: "PaymentClaim",
        targetId: claim.id,
        metadata: {
          memberId: claim.memberId,
          membershipId: claim.membershipId,
          claimedAmountPaise,
          confirmedAmountPaise,
          paymentId: payment.id,
          paymentMethod: claim.paymentMethod,
          reference: claim.reference,
        },
      });
      await writeAuditEvent(tx, {
        organizationId: scope.organizationId,
        actorUserId: scope.userId,
        event: AUDIT_EVENT_PAYMENT_CONFIRMED,
        targetType: "Payment",
        targetId: payment.id,
        metadata: {
          memberId: claim.memberId,
          membershipId: claim.membershipId,
          amountPaise: confirmedAmountPaise,
          paymentMethod: claim.paymentMethod,
          reference: claim.reference,
          paymentClaimId: claim.id,
        },
      });
      return { paymentId: payment.id, deduplicated: false as const };
    });
    return {
      claimId: claim.id,
      paymentId: result.paymentId,
      ...(result.deduplicated ? { deduplicated: true } : {}),
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      if (idempotencyKey) {
        // The token index fired: a concurrent operation with the same
        // token committed first. Resolve to it when it is exactly this
        // confirmation; otherwise it is an idempotency conflict.
        const existing = await findPaymentByIdempotencyKey(
          scope.organizationId,
          idempotencyKey,
        );
        if (existing) {
          if (isSameConfirmation(existing, claim.id, confirmedAmountPaise)) {
            return {
              claimId: claim.id,
              paymentId: existing.id,
              deduplicated: true,
            };
          }
          throw new PaymentClaimIdempotencyConflictError();
        }
      }
      // The unique payment link fired (paranoid second lock): the claim
      // already has its payment, which is the conflict outcome.
      throw new PaymentClaimConflictError();
    }
    throw error;
  }
}

/** Reject a claim: it closes without creating any payment. */
export async function rejectPaymentClaim(
  staffUserId: string,
  claimId: string,
): Promise<{ claimId: string }> {
  const scope = await requireVerifyScope(staffUserId);
  const claim = await findClaimInScope(scope.organizationId, claimId);
  const now = new Date();

  await db.$transaction(async (tx) => {
    // Same in-transaction verifier revalidation as confirm.
    await revalidateVerifierInTransaction(tx, scope);
    const transition = await tx.paymentClaim.updateMany({
      where: {
        id: claim.id,
        organizationId: scope.organizationId,
        status: "PENDING",
      },
      data: { status: "REJECTED", verifiedAt: now, verifiedBy: scope.userId },
    });
    if (transition.count === 0) {
      throw new PaymentClaimConflictError();
    }
    await writeAuditEvent(tx, {
      organizationId: scope.organizationId,
      actorUserId: scope.userId,
      event: AUDIT_EVENT_PAYMENT_CLAIM_REJECTED,
      targetType: "PaymentClaim",
      targetId: claim.id,
      metadata: {
        memberId: claim.memberId,
        membershipId: claim.membershipId,
        claimedAmountPaise: decimalToPaise(claim.claimedAmount),
        paymentMethod: claim.paymentMethod,
        reference: claim.reference,
      },
    });
  });
  return { claimId: claim.id };
}
