import "server-only";

import { Prisma, type PaymentClaimStatus, type Role } from "@prisma/client";

import {
  validatePaymentInput,
  type PaymentInput,
  type PaymentMethod,
} from "../members";
import { getPrimaryMembership } from "./authorization";
import {
  AUDIT_EVENT_PAYMENT_CLAIM_CONFIRMED,
  AUDIT_EVENT_PAYMENT_CLAIM_REJECTED,
  AUDIT_EVENT_PAYMENT_CLAIM_SUBMITTED,
  AUDIT_EVENT_PAYMENT_CONFIRMED,
  writeAuditEvent,
} from "./audit";
import { db } from "./db";
import { canRecordPayment } from "./payments";

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
export async function confirmPaymentClaim(
  staffUserId: string,
  claimId: string,
  input?: { amount?: string },
): Promise<{ claimId: string; paymentId: string }> {
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
  const now = new Date();

  try {
    const paymentId = await db.$transaction(async (tx) => {
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
      return payment.id;
    });
    return { claimId: claim.id, paymentId };
  } catch (error) {
    // The unique payment link fired (paranoid second lock): the claim
    // already has its payment, which is the conflict outcome.
    if (isUniqueViolation(error)) {
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
