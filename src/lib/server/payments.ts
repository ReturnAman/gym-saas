import "server-only";

import { Prisma, type Role } from "@prisma/client";

import {
  validatePaymentInput,
  type PaymentInput,
  type PaymentMethod,
} from "../members";
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
 */
export async function recordPayment(
  userId: string,
  memberId: string,
  input: PaymentInput,
): Promise<{ paymentId: string }> {
  const scope = await resolveScope(userId);
  if (!canRecordPayment(scope.role)) {
    throw new PaymentAuthorizationError(
      "You do not have permission to record payments.",
    );
  }

  const validated = validatePaymentInput(input);

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

  const paymentId = await db.$transaction(async (tx) => {
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

  return { paymentId };
}
