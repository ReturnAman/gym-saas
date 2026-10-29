import "server-only";

import { Prisma, type Role } from "@prisma/client";

import {
  PaymentReversalValidationError,
  PaymentValidationError,
  validatePaymentInput,
  validatePaymentReversalInput,
  type PaymentInput,
  type PaymentMethod,
  type PaymentReversalInput,
  type PaymentReversalReason,
} from "../members";
import { isValidIdempotencyKey } from "../idempotency";
import { getPrimaryMembership } from "./authorization";
import {
  AUDIT_EVENT_PAYMENT_CONFIRMED,
  AUDIT_EVENT_PAYMENT_REVERSED,
  writeAuditEvent,
} from "./audit";
import { db } from "./db";
import {
  assertOperationsAllowed,
  assertOperationsAllowedInTransaction,
} from "./subscriptions";

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
 * - Reverse payment: OWNER, ADMIN only. STAFF may record a payment but
 *   may not reverse one.
 *
 * Recording a payment never modifies the membership (plan, dates, fee):
 * payment and renewal are separate domains.
 *
 * A reversal is an append-only correction record (PaymentReversal): it
 * never edits or deletes the original payment, and every total this
 * module reports is net — confirmed payments minus their reversals.
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

/**
 * Thrown when a reversal amount exceeds what can still be reversed for
 * the payment (its amount minus its prior reversals). Carries the exact
 * remaining reversible amount in paise so the UI can state it.
 */
export class PaymentReversalExceedsError extends Error {
  readonly remainingPaise: number;

  constructor(remainingPaise: number) {
    super(
      "The reversal amount exceeds the amount that can still be reversed for this payment.",
    );
    this.name = "PaymentReversalExceedsError";
    this.remainingPaise = remainingPaise;
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

/**
 * Roles allowed to reverse a confirmed payment. Deliberately narrower
 * than recording: reversing is a financial correction, so STAFF — who
 * may record payments — may not reverse them.
 */
export function canReversePayment(role: Role): boolean {
  return role === "OWNER" || role === "ADMIN";
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
 * Lock the actor's own membership row inside the caller's transaction
 * and return its CURRENT organization and role (shared by the recorder
 * and reverser revalidations below).
 */
async function lockActorMembership(
  tx: Prisma.TransactionClient,
  scope: PaymentScope,
): Promise<LockedRecorderMembership> {
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
  return current;
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
  const current = await lockActorMembership(tx, scope);
  if (!canRecordPayment(current.role)) {
    throw new PaymentAuthorizationError(
      "You do not have permission to record payments.",
    );
  }
}

/**
 * The reverser's counterpart of revalidateRecorderInTransaction: same
 * lock and fresh-role read, narrower permission — a user demoted from
 * OWNER/ADMIN to STAFF between page render and submit keeps the ability
 * to record payments but must not reverse one.
 */
async function revalidateReverserInTransaction(
  tx: Prisma.TransactionClient,
  scope: PaymentScope,
): Promise<void> {
  const current = await lockActorMembership(tx, scope);
  if (!canReversePayment(current.role)) {
    throw new PaymentAuthorizationError(
      "You do not have permission to reverse payments.",
    );
  }
}

/** Prisma.Decimal → integer paise (exact; Decimal mul is not floating point). */
function decimalToPaise(value: Prisma.Decimal): number {
  return value.mul(100).toNumber();
}

/**
 * NET confirmed paid total in paise per membership — SUM(payment
 * amounts) − SUM(reversal amounts) — for the given membership IDs inside
 * one organization. This is the single funnel every paid/outstanding
 * figure in the application derives from: netting reversals here keeps
 * the staff member list, the member detail, and the member-facing
 * summary consistent by construction. Memberships with no payments are
 * absent from the map (their sum is 0). Derived from the ledger records
 * every time — no balance is ever persisted.
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
  const reversalRows = await db.paymentReversal.groupBy({
    by: ["membershipId"],
    where: { organizationId, membershipId: { in: membershipIds } },
    _sum: { amount: true },
  });
  for (const row of reversalRows) {
    const reversedPaise = row._sum.amount ? decimalToPaise(row._sum.amount) : 0;
    if (reversedPaise !== 0) {
      sums.set(
        row.membershipId,
        (sums.get(row.membershipId) ?? 0) - reversedPaise,
      );
    }
  }
  return sums;
}

export interface PaymentHistoryItem {
  id: string;
  /** Gross confirmed amount — reversals are reported separately below. */
  amountPaise: number;
  paymentMethod: PaymentMethod;
  reference: string | null;
  /** ISO timestamp of when the payment was confirmed/recorded. */
  confirmedAt: string;
  /** Role of the confirming staff user inside this organization, if known. */
  confirmedByRole: Role | null;
  /** Total reversed against this payment so far. */
  reversedPaise: number;
  /**
   * Amount that can still be reversed (amountPaise − reversedPaise).
   * Zero means the payment is fully reversed.
   */
  remainingReversiblePaise: number;
}

export interface PaymentReversalHistoryItem {
  id: string;
  paymentId: string;
  amountPaise: number;
  reason: PaymentReversalReason;
  explanation: string | null;
  /** ISO timestamp of when the reversal was recorded. */
  reversedAt: string;
  /** Role of the reversing user inside this organization, if known. */
  reversedByRole: Role | null;
}

/**
 * Display bound for one membership's payment and reversal histories
 * (M1): newest first, matching the member-facing claim history's
 * bound. Paid/outstanding totals never derive from these lists —
 * they come from sumConfirmedPaymentsByMembership's aggregates — so
 * the bound limits rendering only, never the money math.
 */
export const PAYMENT_HISTORY_LIMIT = 50;

/** A bounded history read: the displayed records plus a truncation flag. */
export interface PaymentHistory {
  /** Newest first, at most PAYMENT_HISTORY_LIMIT entries. */
  items: PaymentHistoryItem[];
  /** True when older payments exist beyond the displayed records. */
  truncated: boolean;
}

/**
 * Confirmed payment history for one membership, newest first,
 * bounded at the database to PAYMENT_HISTORY_LIMIT with a one-row
 * probe detecting truncation. Tenant scope is the caller's:
 * `organizationId` must already be resolved server-side (this
 * helper performs no authorization of its own).
 */
export async function listPaymentsForMembership(
  organizationId: string,
  membershipId: string,
): Promise<PaymentHistory> {
  const rows = await db.payment.findMany({
    where: { organizationId, membershipId },
    orderBy: { confirmedAt: "desc" },
    take: PAYMENT_HISTORY_LIMIT + 1,
  });
  const payments = rows.slice(0, PAYMENT_HISTORY_LIMIT);
  const truncated = rows.length > PAYMENT_HISTORY_LIMIT;
  if (payments.length === 0) return { items: [], truncated: false };

  // Reversal totals per payment, so each receipt can show how much of
  // it has been reversed and how much can still be reversed.
  const reversalRows = await db.paymentReversal.groupBy({
    by: ["paymentId"],
    where: { organizationId, membershipId },
    _sum: { amount: true },
  });
  const reversedByPaymentId = new Map(
    reversalRows.map((row) => [
      row.paymentId,
      row._sum.amount ? decimalToPaise(row._sum.amount) : 0,
    ]),
  );

  // Resolve who confirmed each payment to their role in this organization
  // (the application User record carries no display name).
  const confirmerIds = [...new Set(payments.map((p) => p.confirmedBy))];
  const confirmerMemberships = await db.organizationMembership.findMany({
    where: { organizationId, userId: { in: confirmerIds } },
    select: { userId: true, role: true },
  });
  const roleByUserId = new Map(confirmerMemberships.map((m) => [m.userId, m.role]));

  return {
    items: payments.map((payment) => {
      const amountPaise = decimalToPaise(payment.amount);
      const reversedPaise = reversedByPaymentId.get(payment.id) ?? 0;
      return {
        id: payment.id,
        amountPaise,
        paymentMethod: payment.paymentMethod,
        reference: payment.reference,
        confirmedAt: payment.confirmedAt.toISOString(),
        confirmedByRole: roleByUserId.get(payment.confirmedBy) ?? null,
        reversedPaise,
        remainingReversiblePaise: amountPaise - reversedPaise,
      };
    }),
    truncated,
  };
}

/** A bounded reversal-history read, mirroring PaymentHistory. */
export interface ReversalHistory {
  /** Newest first, at most PAYMENT_HISTORY_LIMIT entries. */
  items: PaymentReversalHistoryItem[];
  /** True when older reversals exist beyond the displayed records. */
  truncated: boolean;
}

/**
 * Reversal history for one membership, newest first — the correction
 * entries that net against listPaymentsForMembership's receipts —
 * bounded exactly like the payment history above. Tenant scope is
 * the caller's, exactly as for the payment history helper.
 */
export async function listReversalsForMembership(
  organizationId: string,
  membershipId: string,
): Promise<ReversalHistory> {
  const rows = await db.paymentReversal.findMany({
    where: { organizationId, membershipId },
    orderBy: { createdAt: "desc" },
    take: PAYMENT_HISTORY_LIMIT + 1,
  });
  const reversals = rows.slice(0, PAYMENT_HISTORY_LIMIT);
  const truncated = rows.length > PAYMENT_HISTORY_LIMIT;
  if (reversals.length === 0) return { items: [], truncated: false };

  // Resolve who reversed each payment to their role in this
  // organization (same convention as the payment history above).
  const reverserIds = [...new Set(reversals.map((r) => r.reversedBy))];
  const reverserMemberships = await db.organizationMembership.findMany({
    where: { organizationId, userId: { in: reverserIds } },
    select: { userId: true, role: true },
  });
  const roleByUserId = new Map(reverserMemberships.map((m) => [m.userId, m.role]));

  return {
    items: reversals.map((reversal) => ({
      id: reversal.id,
      paymentId: reversal.paymentId,
      amountPaise: decimalToPaise(reversal.amount),
      reason: reversal.reason,
      explanation: reversal.explanation,
      reversedAt: reversal.createdAt.toISOString(),
      reversedByRole: roleByUserId.get(reversal.reversedBy) ?? null,
    })),
    truncated,
  };
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
  await assertOperationsAllowed(scope.organizationId);

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
      await assertOperationsAllowedInTransaction(tx, scope.organizationId);
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

// ---------------------------------------------------------------------------
// Payment reversals
// ---------------------------------------------------------------------------

interface RecordedReversalRow {
  id: string;
  paymentId: string;
  amount: Prisma.Decimal;
  reason: PaymentReversalReason;
  explanation: string | null;
}

async function findReversalByIdempotencyKey(
  organizationId: string,
  idempotencyKey: string,
): Promise<RecordedReversalRow | null> {
  return db.paymentReversal.findUnique({
    where: {
      organizationId_idempotencyKey: { organizationId, idempotencyKey },
    },
    select: {
      id: true,
      paymentId: true,
      amount: true,
      reason: true,
      explanation: true,
    },
  });
}

/**
 * A replayed reversal token resolves to the original reversal — but
 * only when the stored reversal is exactly the operation being
 * retried: same payment, same amount, same reason, same explanation.
 * Anything else means the token was reused for a different operation,
 * which is rejected (the same rule as resolveIdempotentReplay).
 */
function resolveReversalIdempotentReplay(
  existing: RecordedReversalRow,
  expected: {
    paymentId: string;
    amountPaise: number;
    reason: PaymentReversalReason;
    explanation: string | null;
  },
): { reversalId: string; deduplicated: true } {
  if (
    existing.paymentId !== expected.paymentId ||
    decimalToPaise(existing.amount) !== expected.amountPaise ||
    existing.reason !== expected.reason ||
    existing.explanation !== expected.explanation
  ) {
    throw new PaymentIdempotencyConflictError(
      "This reversal submission was already used with different details.",
    );
  }
  return { reversalId: existing.id, deduplicated: true };
}

/**
 * Reverse some or all of a confirmed payment by appending a
 * PaymentReversal record. The original payment is never updated or
 * deleted, no money moves (a reversal records a correction the gym has
 * made — it is not a gateway refund), and neither the membership nor a
 * payment claim behind the payment changes state.
 *
 * Authorization: OWNER and ADMIN only, revalidated inside the
 * transaction under a lock on the actor's own membership row — a user
 * demoted to STAFF after the page rendered keeps the ability to record
 * payments but must not reverse one.
 *
 * The cumulative invariant (a payment's reversals never exceed its
 * amount) is enforced by locking the payment row for the duration of
 * the transaction and only then summing its prior reversals: a
 * concurrent reversal of the same payment waits on that lock and sums
 * the committed state, so the two can never jointly over-reverse.
 * Amounts are exact integer paise throughout.
 *
 * The reversal and its PAYMENT_REVERSED audit event are written in one
 * transaction: either both exist or neither does. The free-text
 * explanation is stored on the reversal record only — it is
 * deliberately not copied into the audit metadata.
 *
 * Idempotency mirrors recordPayment: the (organizationId,
 * idempotencyKey) unique index guarantees at most one reversal per
 * operation token; a same-payload replay returns the original
 * ({ deduplicated: true }) without writing a second reversal or audit
 * event, and a different-payload replay is rejected. The token is
 * checked before the transaction, again inside it under the payment
 * lock, and once more if the unique index rejects the insert — a
 * concurrent winner may commit at any of those points, and every
 * path resolves to it rather than retrying blindly.
 */
export async function reversePayment(
  userId: string,
  paymentId: string,
  input: PaymentReversalInput,
  options?: { idempotencyKey?: string },
): Promise<{ reversalId: string; deduplicated?: boolean }> {
  const scope = await resolveScope(userId);
  if (!canReversePayment(scope.role)) {
    throw new PaymentAuthorizationError(
      "You do not have permission to reverse payments.",
    );
  }
  await assertOperationsAllowed(scope.organizationId);

  const validated = validatePaymentReversalInput(input);
  const expectedPayload = {
    paymentId,
    amountPaise: validated.amountPaise,
    reason: validated.reason,
    explanation: validated.explanation,
  };

  const idempotencyKey = options?.idempotencyKey;
  if (idempotencyKey !== undefined && !isValidIdempotencyKey(idempotencyKey)) {
    throw new PaymentReversalValidationError({
      form: "This reversal submission could not be verified. Refresh the page and try again.",
    });
  }

  if (idempotencyKey) {
    const existing = await findReversalByIdempotencyKey(
      scope.organizationId,
      idempotencyKey,
    );
    if (existing) return resolveReversalIdempotentReplay(existing, expectedPayload);
  }

  let result: { reversalId: string; deduplicated?: boolean };
  try {
    result = await db.$transaction(async (tx) => {
      // Revalidate the reverser under lock before any write: a
      // demoted/removed actor must not reverse, even mid-request.
      await revalidateReverserInTransaction(tx, scope);
      await assertOperationsAllowedInTransaction(tx, scope.organizationId);

      const payment = await tx.payment.findFirst({
        where: { id: paymentId, organizationId: scope.organizationId },
        select: {
          id: true,
          memberId: true,
          membershipId: true,
          amount: true,
          paymentClaimId: true,
        },
      });
      if (!payment) {
        // Foreign and nonexistent payments are indistinguishable.
        throw new PaymentNotFoundError("Payment not found.");
      }

      // Serialize reversals of THIS payment: hold its row lock until
      // commit, so the prior-reversal sum below reads committed state
      // even against a concurrent reversal of the same payment.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM payments
        WHERE organization_id = ${scope.organizationId} AND id = ${payment.id}
        FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new PaymentNotFoundError("Payment not found.");
      }

      if (idempotencyKey) {
        // A concurrent submission with the same token may have
        // committed while this transaction waited on the locks above
        // (its pre-transaction lookup raced ahead of that commit).
        // Re-check the token now — under the payment lock, before the
        // invariant — so a racing retry resolves to the original
        // reversal instead of failing against the winner's committed
        // reversal as if it were an unrelated over-reversal.
        const existingInTx = await tx.paymentReversal.findUnique({
          where: {
            organizationId_idempotencyKey: {
              organizationId: scope.organizationId,
              idempotencyKey,
            },
          },
          select: {
            id: true,
            paymentId: true,
            amount: true,
            reason: true,
            explanation: true,
          },
        });
        if (existingInTx) {
          return resolveReversalIdempotentReplay(existingInTx, expectedPayload);
        }
      }

      const prior = await tx.paymentReversal.aggregate({
        where: { organizationId: scope.organizationId, paymentId: payment.id },
        _sum: { amount: true },
      });
      const alreadyReversedPaise = prior._sum.amount
        ? decimalToPaise(prior._sum.amount)
        : 0;
      const remainingPaise = decimalToPaise(payment.amount) - alreadyReversedPaise;
      if (validated.amountPaise > remainingPaise) {
        throw new PaymentReversalExceedsError(remainingPaise);
      }

      const reversal = await tx.paymentReversal.create({
        data: {
          organizationId: scope.organizationId,
          paymentId: payment.id,
          // Member and membership are copied from the locked payment
          // row — never from client input.
          memberId: payment.memberId,
          membershipId: payment.membershipId,
          // Exact Decimal from integer paise — no floating point.
          amount: new Prisma.Decimal(validated.amountPaise).div(100),
          reason: validated.reason,
          explanation: validated.explanation,
          reversedBy: scope.userId,
          idempotencyKey: idempotencyKey ?? null,
        },
        select: { id: true },
      });
      await writeAuditEvent(tx, {
        organizationId: scope.organizationId,
        actorUserId: scope.userId,
        event: AUDIT_EVENT_PAYMENT_REVERSED,
        targetType: "Payment",
        targetId: payment.id,
        metadata: {
          reversalId: reversal.id,
          memberId: payment.memberId,
          membershipId: payment.membershipId,
          amountPaise: validated.amountPaise,
          reason: validated.reason,
          ...(payment.paymentClaimId
            ? { paymentClaimId: payment.paymentClaimId }
            : {}),
        },
      });
      return { reversalId: reversal.id };
    });
  } catch (error) {
    // A concurrent submission with the same token won the race: the
    // unique index rejected this transaction's insert. Resolve to the
    // winner when it is the same operation; a different payload (or an
    // unrelated unique failure with no stored token row) keeps its
    // error. Read-only resolution — the write is never blindly retried.
    if (idempotencyKey && isUniqueViolation(error)) {
      const existing = await findReversalByIdempotencyKey(
        scope.organizationId,
        idempotencyKey,
      );
      if (existing) return resolveReversalIdempotentReplay(existing, expectedPayload);
    }
    throw error;
  }

  return result;
}
