import "server-only";

import { Prisma, type Role } from "@prisma/client";

import {
  PaymentValidationError,
  validatePaymentInput,
  type PaymentInput,
  type PaymentMethod,
} from "../members";
import { isValidIdempotencyKey } from "../idempotency";
import { getPrimaryMembership } from "./authorization";
import { AUDIT_EVENT_PAYMENT_CONFIRMED, writeAuditEvent } from "./audit";
import { db } from "./db";

/**
 * Server-side Payments service (04-DATABASE-DESIGN §14, §16, §17;
 * docs/05-AUTHORIZATION.md §8 V1 permission matrix).
 *
 * A Payment is a confirmed payment received by the gym, recorded by an
 * authorized staff user. Member payment claims are a later slice (member
 * OTP onboarding/linking does not exist yet), so nothing here creates or
 * verifies claims.
 *
 * Tenant isolation follows the members service pattern: the organization
 * is resolved from the authenticated user's own membership — never from
 * client input — and every lookup carries the organization ID, so a member
 * or membership from another organization is indistinguishable from a
 * missing one.
 *
 * Permission model (matrix §8, as approved for V1):
 * - Record payment: OWNER, ADMIN, STAFF. TRAINER and MEMBER: no.
 *
 * Recording a payment never modifies the membership (plan, dates, fee):
 * payment and renewal are separate domains.
 */

/** Thrown when the caller lacks permission or the tenant scope fails. */
export class PaymentAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentAuthorizationError";
  }
}

/** Thrown when the member/membership cannot be found in the caller's org. */
export class PaymentNotFoundError extends Error {
  constructor(message = "Member not found.") {
    super(message);
    this.name = "PaymentNotFoundError";
  }
}

/**
 * Thrown when an idempotency token was already used for a DIFFERENT
 * payment operation (H4). Reusing a token with the same payload is a
 * safe replay and resolves to the original payment instead; reusing
 * it with a different payload is a client bug or a stale form, and is
 * rejected without creating anything.
 */
export class PaymentIdempotencyConflictError extends Error {
  constructor(
    message = "This payment submission was already used with different details.",
  ) {
    super(message);
    this.name = "PaymentIdempotencyConflictError";
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/** Roles allowed to record a confirmed payment in V1. */
export function canRecordPayment(role: Role): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "STAFF";
}

interface PaymentScope {
  userId: string;
  organizationId: string;
  role: Role;
}

/**
 * Resolve the caller's tenant scope from their own organization membership.
 * The organization ID is never accepted from the caller.
 */
async function resolveScope(userId: string): Promise<PaymentScope> {
  if (!userId) {
    throw new PaymentAuthorizationError("Authentication is required.");
  }
  const membership = await getPrimaryMembership(userId);
  if (!membership) {
    throw new PaymentAuthorizationError("You do not belong to an organization.");
  }
  return {
    userId,
    organizationId: membership.organizationId,
    role: membership.role,
  };
}

interface LockedRecorderMembership {
  organizationId: string;
  role: Role;
}

/**
 * Re-derive the recorder's authority inside the recording transaction,
 * under a lock on their own membership row (the staff.ts
 * revalidateActorInTransaction pattern, as in payment-claims.ts).
 * resolveScope's earlier check is only a fast path: between it and
 * this transaction the actor may have been demoted or removed, and a
 * revoked actor must not create a confirmed payment. The lock also
 * serializes against the revocation itself — deleting the membership
 * needs this row — so the two linearize instead of racing.
 *
 * The row selected is exactly resolveScope's: the actor's earliest
 * organization membership (getPrimaryMembership's ordering).
 */
async function revalidateRecorderInTransaction(
  tx: Prisma.TransactionClient,
  scope: PaymentScope,
): Promise<void> {
  const rows = await tx.$queryRaw<LockedRecorderMembership[]>`
    SELECT organization_id AS "organizationId", role
    FROM organization_memberships
    WHERE user_id = ${scope.userId}
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE
  `;
  const current = rows[0];
  if (!current || current.organizationId !== scope.organizationId) {
    throw new PaymentAuthorizationError(
      "Your access changed while you were working. Refresh and try again.",
    );
  }
  if (!canRecordPayment(current.role)) {
    throw new PaymentAuthorizationError(
      "You do not have permission to record payments.",
    );
  }
}

/** Prisma.Decimal → integer paise (exact; Decimal mul is not floating point). */
function decimalToPaise(value: Prisma.Decimal): number {
  return value.mul(100).toNumber();
}

/**
 * SUM(confirmed payments) in paise per membership, for the given membership
 * IDs inside one organization. Memberships with no payments are absent from
 * the map (their sum is 0). Derived from the payment records every time —
 * no balance is ever persisted.
 */
export async function sumConfirmedPaymentsByMembership(
  organizationId: string,
  membershipIds: string[],
): Promise<Map<string, number>> {
  const sums = new Map<string, number>();
  if (membershipIds.length === 0) return sums;
  const rows = await db.payment.groupBy({
    by: ["membershipId"],
    where: { organizationId, membershipId: { in: membershipIds } },
    _sum: { amount: true },
  });
  for (const row of rows) {
    sums.set(row.membershipId, row._sum.amount ? decimalToPaise(row._sum.amount) : 0);
  }
  return sums;
}

export interface PaymentHistoryItem {
  id: string;
  amountPaise: number;
  paymentMethod: PaymentMethod;
  reference: string | null;
  /** ISO timestamp of when the payment was confirmed/recorded. */
  confirmedAt: string;
  /** Role of the confirming staff user inside this organization, if known. */
  confirmedByRole: Role | null;
}

/**
 * Confirmed payment history for one membership, newest first. Tenant
 * scope is the caller's: `organizationId` must already be resolved
 * server-side (this helper performs no authorization of its own).
 */
export async function listPaymentsForMembership(
  organizationId: string,
  membershipId: string,
): Promise<PaymentHistoryItem[]> {
  const payments = await db.payment.findMany({
    where: { organizationId, membershipId },
    orderBy: { confirmedAt: "desc" },
  });
  if (payments.length === 0) return [];

  // Resolve who confirmed each payment to their role in this organization
  // (the application User record carries no display name).
  const confirmerIds = [...new Set(payments.map((p) => p.confirmedBy))];
  const confirmerMemberships = await db.organizationMembership.findMany({
    where: { organizationId, userId: { in: confirmerIds } },
    select: { userId: true, role: true },
  });
  const roleByUserId = new Map(confirmerMemberships.map((m) => [m.userId, m.role]));

  return payments.map((payment) => ({
    id: payment.id,
    amountPaise: decimalToPaise(payment.amount),
    paymentMethod: payment.paymentMethod,
    reference: payment.reference,
    confirmedAt: payment.confirmedAt.toISOString(),
    confirmedByRole: roleByUserId.get(payment.confirmedBy) ?? null,
  }));
}

interface RecordedPaymentRow {
  id: string;
  memberId: string;
  amount: Prisma.Decimal;
  paymentMethod: PaymentMethod;
  reference: string | null;
  paymentClaimId: string | null;
}

async function findPaymentByIdempotencyKey(
  organizationId: string,
  idempotencyKey: string,
): Promise<RecordedPaymentRow | null> {
  return db.payment.findUnique({
    where: {
      organizationId_idempotencyKey: { organizationId, idempotencyKey },
    },
    select: {
      id: true,
      memberId: true,
      amount: true,
      paymentMethod: true,
      reference: true,
      paymentClaimId: true,
    },
  });
}

/**
 * A replayed operation token resolves to the original payment — but
 * only when the stored payment is exactly the operation being
 * retried: same member, same amount, same method, same reference, and
 * not a claim-confirmation payment. Anything else means the token was
 * reused for a different operation, which is rejected.
 */
function resolveIdempotentReplay(
  existing: RecordedPaymentRow,
  expected: {
    memberId: string;
    amountPaise: number;
    paymentMethod: PaymentMethod;
    reference: string | null;
  },
): { paymentId: string; deduplicated: true } {
  if (
    existing.paymentClaimId !== null ||
    existing.memberId !== expected.memberId ||
    decimalToPaise(existing.amount) !== expected.amountPaise ||
    existing.paymentMethod !== expected.paymentMethod ||
    existing.reference !== expected.reference
  ) {
    throw new PaymentIdempotencyConflictError();
  }
  return { paymentId: existing.id, deduplicated: true };
}

/**
 * Record a confirmed payment against a member's current (latest)
 * membership.
 *
 * The payment and its PAYMENT_CONFIRMED audit event are written in one
 * transaction (ADR 013/017): either both exist or neither does. The
 * membership row itself is never modified — recording a payment does not
 * renew, extend, or reprice a membership. Overpayment is allowed: the paid
 * total stays the actual confirmed sum and the derived status is OVERPAID
 * with outstanding ₹0.
 *
 * Idempotency (H4): when the caller supplies an operation token, the
 * database unique index on (organizationId, idempotencyKey) guarantees
 * at most one payment per token. A replay with the same payload returns
 * the original payment ({ deduplicated: true }) without writing a
 * second payment or audit event; a replay with a different payload is
 * rejected with PaymentIdempotencyConflictError.
 */
export async function recordPayment(
  userId: string,
  memberId: string,
  input: PaymentInput,
  options?: { idempotencyKey?: string },
): Promise<{ paymentId: string; deduplicated?: boolean }> {
  const scope = await resolveScope(userId);
  if (!canRecordPayment(scope.role)) {
    throw new PaymentAuthorizationError(
      "You do not have permission to record payments.",
    );
  }

  const validated = validatePaymentInput(input);

  const idempotencyKey = options?.idempotencyKey;
  if (idempotencyKey !== undefined && !isValidIdempotencyKey(idempotencyKey)) {
    throw new PaymentValidationError({
      form: "This payment submission could not be verified. Refresh the page and try again.",
    });
  }

  const member = await db.member.findFirst({
    where: { id: memberId, organizationId: scope.organizationId },
    select: { id: true },
  });
  if (!member) {
    throw new PaymentNotFoundError();
  }

  const membership = await db.membership.findFirst({
    where: { memberId: member.id, organizationId: scope.organizationId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!membership) {
    throw new PaymentNotFoundError("This member has no membership to pay against.");
  }

  const expectedPayload = {
    memberId: member.id,
    amountPaise: validated.amountPaise,
    paymentMethod: validated.paymentMethod,
    reference: validated.reference,
  };

  if (idempotencyKey) {
    const existing = await findPaymentByIdempotencyKey(
      scope.organizationId,
      idempotencyKey,
    );
    if (existing) return resolveIdempotentReplay(existing, expectedPayload);
  }

  let paymentId: string;
  try {
    paymentId = await db.$transaction(async (tx) => {
      // Revalidate the recorder under lock before any write: a
      // demoted/removed actor must not record, even mid-request.
      await revalidateRecorderInTransaction(tx, scope);
      const payment = await tx.payment.create({
        data: {
          organizationId: scope.organizationId,
          memberId: member.id,
          membershipId: membership.id,
          // Exact Decimal from integer paise — no floating point.
          amount: new Prisma.Decimal(validated.amountPaise).div(100),
          paymentMethod: validated.paymentMethod,
          reference: validated.reference,
          confirmedAt: new Date(),
          confirmedBy: scope.userId,
          idempotencyKey: idempotencyKey ?? null,
        },
        select: { id: true },
      });
      await writeAuditEvent(tx, {
        organizationId: scope.organizationId,
        actorUserId: scope.userId,
        event: AUDIT_EVENT_PAYMENT_CONFIRMED,
        targetType: "Payment",
        targetId: payment.id,
        metadata: {
          memberId: member.id,
          membershipId: membership.id,
          amountPaise: validated.amountPaise,
          paymentMethod: validated.paymentMethod,
          reference: validated.reference,
        },
      });
      return payment.id;
    });
  } catch (error) {
    // A concurrent submission with the same token won the race: the
    // unique index rejected this transaction's insert. Resolve to the
    // winner when it is the same operation; a different payload (or an
    // unrelated unique failure with no stored token row) keeps its
    // error. This is a read-only resolution — the write is never
    // blindly retried.
    if (idempotencyKey && isUniqueViolation(error)) {
      const existing = await findPaymentByIdempotencyKey(
        scope.organizationId,
        idempotencyKey,
      );
      if (existing) return resolveIdempotentReplay(existing, expectedPayload);
    }
    throw error;
  }

  return { paymentId };
}
