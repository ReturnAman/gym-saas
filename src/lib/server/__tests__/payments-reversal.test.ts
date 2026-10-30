import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const {
  mockTransaction,
  mockOrgMembershipFindFirst,
  mockOrgMembershipFindMany,
  mockPaymentFindMany,
  mockPaymentGroupBy,
  mockPaymentReversalGroupBy,
  mockPaymentReversalFindMany,
  mockPaymentReversalFindUnique,
  mockTxQueryRaw,
  mockTxPaymentFindFirst,
  mockTxReversalAggregate,
  mockTxReversalCreate,
  mockTxReversalFindUnique,
  mockAuditLogCreate,
} = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockOrgMembershipFindFirst: vi.fn(),
  mockOrgMembershipFindMany: vi.fn(),
  mockPaymentFindMany: vi.fn(),
  mockPaymentGroupBy: vi.fn(),
  mockPaymentReversalGroupBy: vi.fn(),
  mockPaymentReversalFindMany: vi.fn(),
  mockPaymentReversalFindUnique: vi.fn(),
  mockTxQueryRaw: vi.fn(),
  mockTxPaymentFindFirst: vi.fn(),
  mockTxReversalAggregate: vi.fn(),
  mockTxReversalCreate: vi.fn(),
  mockTxReversalFindUnique: vi.fn(),
  mockAuditLogCreate: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({
  db: {
    organizationSubscription: { findUnique: vi.fn(async () => ({ suspendedAt: null, paidThroughAt: null, trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60_000) })) },
    organizationMembership: {
      findFirst: mockOrgMembershipFindFirst,
      findMany: mockOrgMembershipFindMany,
    },
    payment: { groupBy: mockPaymentGroupBy, findMany: mockPaymentFindMany },
    paymentReversal: {
      groupBy: mockPaymentReversalGroupBy,
      findMany: mockPaymentReversalFindMany,
      findUnique: mockPaymentReversalFindUnique,
    },
    $transaction: mockTransaction,
  },
}));

// The real getPrimaryMembership runs against the mocked db above; only the
// Clerk-touching auth module is stubbed out.
vi.mock("@/lib/server/auth", () => ({
  getCurrentUser: vi.fn(),
}));

import { PaymentReversalValidationError } from "@/lib/members";
import { AUDIT_EVENT_PAYMENT_REVERSED } from "@/lib/server/audit";
import {
  PAYMENT_HISTORY_LIMIT,
  PaymentAuthorizationError,
  PaymentIdempotencyConflictError,
  PaymentNotFoundError,
  PaymentReversalExceedsError,
  canReversePayment,
  listPaymentsForMembership,
  listReversalsForMembership,
  reversePayment,
  sumConfirmedPaymentsByMembership,
} from "@/lib/server/payments";

const USER_ID = "b2198c2a-f96e-22da-cd1a-00222444be2e";
const ORG_ID = "c3298d3b-a07f-33eb-de2b-00333455cf3f";
const MEMBER_ID = "f65a9b4e-d21c-44de-bc3d-00666788ef4f";
const MEMBERSHIP_ID = "d47a1c5b-8e3f-4a2b-9c1d-001122334455";
const PAYMENT_ID = "a12b3c4d-5e6f-47a8-b9c0-0a1b2c3d4e5f";
const REVERSAL_ID = "c34d5e6f-7a8b-49c0-b1d2-3e4f5a6b7c8d";
const TOKEN = "tok-reversal-0001-abcd";

const VALID_INPUT = {
  amount: "2500.50",
  reason: "WRONG_AMOUNT",
  explanation: "",
};

function mockRoleScope(role: string) {
  mockOrgMembershipFindFirst.mockResolvedValue({
    userId: USER_ID,
    organizationId: ORG_ID,
    role,
  });
}

/**
 * The transaction's two raw queries are distinguished by their SQL:
 * the actor-membership lock (organization_memberships) returns the
 * actor's CURRENT role (defaulting to the scope role), and the payment
 * lock (FROM payments) returns the locked row id.
 */
function mockTransactionBody(actorRole = "OWNER") {
  mockTxQueryRaw.mockImplementation(async (strings: readonly string[]) => {
    const sql = strings.join(" ");
    if (sql.includes("organization_memberships")) {
      return [{ organizationId: ORG_ID, role: actorRole }];
    }
    return [{ id: PAYMENT_ID }];
  });
  mockTxPaymentFindFirst.mockResolvedValue({
    id: PAYMENT_ID,
    memberId: MEMBER_ID,
    membershipId: MEMBERSHIP_ID,
    amount: new Prisma.Decimal("6000"),
    paymentClaimId: null,
  });
  mockTxReversalAggregate.mockResolvedValue({ _sum: { amount: null } });
  mockTxReversalCreate.mockResolvedValue({ id: REVERSAL_ID });
  mockTxReversalFindUnique.mockResolvedValue(null);
  mockAuditLogCreate.mockResolvedValue({ id: "audit-id" });
  mockTransaction.mockImplementation(async (cb: never) =>
    (cb as (tx: unknown) => Promise<unknown>)({
      organizationSubscription: { findUnique: async () => ({ suspendedAt: null, paidThroughAt: null, trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60_000) }) },
      $queryRaw: mockTxQueryRaw,
      payment: { findFirst: mockTxPaymentFindFirst },
      paymentReversal: {
        aggregate: mockTxReversalAggregate,
        create: mockTxReversalCreate,
        findUnique: mockTxReversalFindUnique,
      },
      auditLog: { create: mockAuditLogCreate },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRoleScope("OWNER");
  mockPaymentReversalFindUnique.mockResolvedValue(null);
  mockTransactionBody();
});

describe("canReversePayment", () => {
  it("allows OWNER and ADMIN only — STAFF may record but never reverse", () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      expect(canReversePayment(role)).toBe(true);
    }
    for (const role of ["STAFF", "TRAINER", "MEMBER"] as const) {
      expect(canReversePayment(role)).toBe(false);
    }
  });
});

describe("reversePayment", () => {
  it("records the reversal and its audit event in one transaction, copying member/membership from the payment", async () => {
    const result = await reversePayment(USER_ID, PAYMENT_ID, VALID_INPUT);
    expect(result).toEqual({ reversalId: REVERSAL_ID });

    const createArg = mockTxReversalCreate.mock.calls[0]?.[0];
    expect(createArg.data).toMatchObject({
      organizationId: ORG_ID,
      paymentId: PAYMENT_ID,
      memberId: MEMBER_ID,
      membershipId: MEMBERSHIP_ID,
      reason: "WRONG_AMOUNT",
      explanation: null,
      reversedBy: USER_ID,
      idempotencyKey: null,
    });
    expect(createArg.data.amount.toString()).toBe("2500.5");

    const auditArg = mockAuditLogCreate.mock.calls[0]?.[0];
    expect(auditArg.data).toMatchObject({
      organizationId: ORG_ID,
      actorUserId: USER_ID,
      event: AUDIT_EVENT_PAYMENT_REVERSED,
      targetType: "Payment",
      targetId: PAYMENT_ID,
    });
    expect(auditArg.data.metadata).toMatchObject({
      reversalId: REVERSAL_ID,
      memberId: MEMBER_ID,
      membershipId: MEMBERSHIP_ID,
      amountPaise: 250_050,
      reason: "WRONG_AMOUNT",
    });
    // The free-text explanation is never copied into audit metadata.
    expect(auditArg.data.metadata).not.toHaveProperty("explanation");
  });

  it("carries the originating claim id into the audit metadata for claim-confirmed payments", async () => {
    mockTxPaymentFindFirst.mockResolvedValue({
      id: PAYMENT_ID,
      memberId: MEMBER_ID,
      membershipId: MEMBERSHIP_ID,
      amount: new Prisma.Decimal("6000"),
      paymentClaimId: "claim-1",
    });
    await reversePayment(USER_ID, PAYMENT_ID, VALID_INPUT);
    const auditArg = mockAuditLogCreate.mock.calls[0]?.[0];
    expect(auditArg.data.metadata).toMatchObject({
      paymentClaimId: "claim-1",
    });
  });

  it("rejects STAFF before any transaction work", async () => {
    mockRoleScope("STAFF");
    await expect(
      reversePayment(USER_ID, PAYMENT_ID, VALID_INPUT),
    ).rejects.toBeInstanceOf(PaymentAuthorizationError);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects invalid input before any transaction work", async () => {
    await expect(
      reversePayment(USER_ID, PAYMENT_ID, {
        amount: "100",
        reason: "NOPE",
        explanation: "",
      }),
    ).rejects.toBeInstanceOf(PaymentReversalValidationError);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects a malformed idempotency token as a form validation error", async () => {
    await expect(
      reversePayment(USER_ID, PAYMENT_ID, VALID_INPUT, {
        idempotencyKey: "short",
      }),
    ).rejects.toBeInstanceOf(PaymentReversalValidationError);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("throws the tenant-safe not-found for a foreign or missing payment", async () => {
    mockTxPaymentFindFirst.mockResolvedValue(null);
    await expect(
      reversePayment(USER_ID, PAYMENT_ID, VALID_INPUT),
    ).rejects.toEqual(new PaymentNotFoundError("Payment not found."));
    expect(mockTxReversalCreate).not.toHaveBeenCalled();
  });

  it("rejects a reversal beyond the remaining reversible amount, stating what remains", async () => {
    mockTxReversalAggregate.mockResolvedValue({
      _sum: { amount: new Prisma.Decimal("5800") },
    });
    const attempt = reversePayment(USER_ID, PAYMENT_ID, {
      amount: "300",
      reason: "OTHER",
      explanation: "",
    });
    await expect(attempt).rejects.toBeInstanceOf(PaymentReversalExceedsError);
    await expect(attempt).rejects.toMatchObject({ remainingPaise: 20_000 });
    expect(mockTxReversalCreate).not.toHaveBeenCalled();
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });

  it("allows a reversal of exactly the remaining amount", async () => {
    mockTxReversalAggregate.mockResolvedValue({
      _sum: { amount: new Prisma.Decimal("5800") },
    });
    const result = await reversePayment(USER_ID, PAYMENT_ID, {
      amount: "200",
      reason: "OTHER",
      explanation: "",
    });
    expect(result).toEqual({ reversalId: REVERSAL_ID });
  });

  it("revalidates the actor inside the transaction: a demotion to STAFF blocks the reversal", async () => {
    mockTransactionBody("STAFF");
    await expect(
      reversePayment(USER_ID, PAYMENT_ID, VALID_INPUT),
    ).rejects.toBeInstanceOf(PaymentAuthorizationError);
    expect(mockTxPaymentFindFirst).not.toHaveBeenCalled();
    expect(mockTxReversalCreate).not.toHaveBeenCalled();
  });

  it("resolves a same-token replay to the original reversal without writing", async () => {
    mockPaymentReversalFindUnique.mockResolvedValue({
      id: REVERSAL_ID,
      paymentId: PAYMENT_ID,
      amount: new Prisma.Decimal("2500.50"),
      reason: "WRONG_AMOUNT",
      explanation: null,
    });
    const result = await reversePayment(USER_ID, PAYMENT_ID, VALID_INPUT, {
      idempotencyKey: TOKEN,
    });
    expect(result).toEqual({ reversalId: REVERSAL_ID, deduplicated: true });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects a token reused with a different payload", async () => {
    mockPaymentReversalFindUnique.mockResolvedValue({
      id: REVERSAL_ID,
      paymentId: PAYMENT_ID,
      amount: new Prisma.Decimal("999"),
      reason: "WRONG_AMOUNT",
      explanation: null,
    });
    await expect(
      reversePayment(USER_ID, PAYMENT_ID, VALID_INPUT, {
        idempotencyKey: TOKEN,
      }),
    ).rejects.toBeInstanceOf(PaymentIdempotencyConflictError);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("resolves the unique-index race to the winning reversal (no blind retry)", async () => {
    mockPaymentReversalFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        id: REVERSAL_ID,
        paymentId: PAYMENT_ID,
        amount: new Prisma.Decimal("2500.50"),
        reason: "WRONG_AMOUNT",
        explanation: null,
      });
    mockTxReversalCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("duplicate", {
        code: "P2002",
        clientVersion: "7.10.0",
      }),
    );
    const result = await reversePayment(USER_ID, PAYMENT_ID, VALID_INPUT, {
      idempotencyKey: TOKEN,
    });
    expect(result).toEqual({ reversalId: REVERSAL_ID, deduplicated: true });
    expect(mockTxReversalCreate).toHaveBeenCalledTimes(1);
  });

  it("resolves a racing same-token retry inside the transaction, before the invariant", async () => {
    // The pre-transaction lookup raced ahead of the winner's commit,
    // but by the time this transaction holds the payment lock the
    // winner's reversal is visible: the retry must resolve to it —
    // even though the winner already consumed the full amount, so
    // the invariant alone would (wrongly) reject the retry.
    mockTxReversalFindUnique.mockResolvedValue({
      id: REVERSAL_ID,
      paymentId: PAYMENT_ID,
      amount: new Prisma.Decimal("2500.50"),
      reason: "WRONG_AMOUNT",
      explanation: null,
    });
    mockTxReversalAggregate.mockResolvedValue({
      _sum: { amount: new Prisma.Decimal("6000") },
    });
    const result = await reversePayment(USER_ID, PAYMENT_ID, VALID_INPUT, {
      idempotencyKey: TOKEN,
    });
    expect(result).toEqual({ reversalId: REVERSAL_ID, deduplicated: true });
    expect(mockTxReversalAggregate).not.toHaveBeenCalled();
    expect(mockTxReversalCreate).not.toHaveBeenCalled();
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });
});

describe("sumConfirmedPaymentsByMembership — net of reversals", () => {
  it("subtracts reversal sums from payment sums, tenant-scoped", async () => {
    mockPaymentGroupBy.mockResolvedValue([
      { membershipId: MEMBERSHIP_ID, _sum: { amount: new Prisma.Decimal("6000") } },
    ]);
    mockPaymentReversalGroupBy.mockResolvedValue([
      { membershipId: MEMBERSHIP_ID, _sum: { amount: new Prisma.Decimal("1500") } },
    ]);
    const sums = await sumConfirmedPaymentsByMembership(ORG_ID, [MEMBERSHIP_ID]);
    expect(sums.get(MEMBERSHIP_ID)).toBe(450_000);
    expect(mockPaymentReversalGroupBy.mock.calls[0]?.[0].where).toEqual({
      organizationId: ORG_ID,
      membershipId: { in: [MEMBERSHIP_ID] },
    });
  });

  it("returns an empty map without querying for no memberships", async () => {
    const sums = await sumConfirmedPaymentsByMembership(ORG_ID, []);
    expect(sums.size).toBe(0);
    expect(mockPaymentGroupBy).not.toHaveBeenCalled();
    expect(mockPaymentReversalGroupBy).not.toHaveBeenCalled();
  });
});

describe("payment and reversal history DTOs", () => {
  it("reports per-receipt reversed and remaining amounts", async () => {
    mockPaymentFindMany.mockResolvedValue([
      {
        id: PAYMENT_ID,
        amount: new Prisma.Decimal("6000"),
        paymentMethod: "UPI",
        reference: null,
        confirmedAt: new Date(Date.UTC(2026, 9, 1, 10, 0)),
        confirmedBy: USER_ID,
      },
    ]);
    mockPaymentReversalGroupBy.mockResolvedValue([
      { paymentId: PAYMENT_ID, _sum: { amount: new Prisma.Decimal("2000") } },
    ]);
    mockOrgMembershipFindMany.mockResolvedValue([
      { userId: USER_ID, role: "OWNER" },
    ]);
    const result = await listPaymentsForMembership(ORG_ID, MEMBERSHIP_ID);
    expect(result.truncated).toBe(false);
    expect(result.items).toEqual([
      {
        id: PAYMENT_ID,
        amountPaise: 600_000,
        paymentMethod: "UPI",
        reference: null,
        confirmedAt: new Date(Date.UTC(2026, 9, 1, 10, 0)).toISOString(),
        confirmedByRole: "OWNER",
        reversedPaise: 200_000,
        remainingReversiblePaise: 400_000,
      },
    ]);
    expect(mockPaymentFindMany.mock.calls[0]?.[0].take).toBe(
      PAYMENT_HISTORY_LIMIT + 1,
    );
  });

  it("caps payment history at the limit and flags truncation via the probe row", async () => {
    mockPaymentFindMany.mockResolvedValue(
      Array.from({ length: PAYMENT_HISTORY_LIMIT + 1 }, (_, i) => ({
        id: `payment-${i}`,
        amount: new Prisma.Decimal("100"),
        paymentMethod: "CASH",
        reference: null,
        confirmedAt: new Date(Date.UTC(2026, 9, 1, 10, 0)),
        confirmedBy: USER_ID,
      })),
    );
    mockPaymentReversalGroupBy.mockResolvedValue([]);
    mockOrgMembershipFindMany.mockResolvedValue([]);
    const result = await listPaymentsForMembership(ORG_ID, MEMBERSHIP_ID);
    expect(result.items).toHaveLength(PAYMENT_HISTORY_LIMIT);
    expect(result.truncated).toBe(true);
  });

  it("maps reversal rows to history items with the reverser's role", async () => {
    mockPaymentReversalFindMany.mockResolvedValue([
      {
        id: REVERSAL_ID,
        paymentId: PAYMENT_ID,
        amount: new Prisma.Decimal("2000"),
        reason: "DUPLICATE_ENTRY",
        explanation: "Recorded twice",
        createdAt: new Date(Date.UTC(2026, 9, 2, 9, 0)),
        reversedBy: USER_ID,
      },
    ]);
    mockOrgMembershipFindMany.mockResolvedValue([
      { userId: USER_ID, role: "ADMIN" },
    ]);
    const result = await listReversalsForMembership(ORG_ID, MEMBERSHIP_ID);
    expect(result.truncated).toBe(false);
    expect(result.items).toEqual([
      {
        id: REVERSAL_ID,
        paymentId: PAYMENT_ID,
        amountPaise: 200_000,
        reason: "DUPLICATE_ENTRY",
        explanation: "Recorded twice",
        reversedAt: new Date(Date.UTC(2026, 9, 2, 9, 0)).toISOString(),
        reversedByRole: "ADMIN",
      },
    ]);
    expect(mockPaymentReversalFindMany.mock.calls[0]?.[0].where).toEqual({
      organizationId: ORG_ID,
      membershipId: MEMBERSHIP_ID,
    });
    expect(mockPaymentReversalFindMany.mock.calls[0]?.[0].take).toBe(
      PAYMENT_HISTORY_LIMIT + 1,
    );
  });

  it("caps reversal history at the limit and flags truncation via the probe row", async () => {
    mockPaymentReversalFindMany.mockResolvedValue(
      Array.from({ length: PAYMENT_HISTORY_LIMIT + 1 }, (_, i) => ({
        id: `reversal-${i}`,
        paymentId: PAYMENT_ID,
        amount: new Prisma.Decimal("100"),
        reason: "OTHER",
        explanation: null,
        createdAt: new Date(Date.UTC(2026, 9, 2, 9, 0)),
        reversedBy: USER_ID,
      })),
    );
    mockOrgMembershipFindMany.mockResolvedValue([]);
    const result = await listReversalsForMembership(ORG_ID, MEMBERSHIP_ID);
    expect(result.items).toHaveLength(PAYMENT_HISTORY_LIMIT);
    expect(result.truncated).toBe(true);
  });
});
