import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const {
  mockTransaction,
  mockOrgMembershipFindFirst,
  mockMemberFindFirst,
  mockMembershipFindFirst,
  mockClaimFindFirst,
  mockClaimFindMany,
  mockClaimCount,
  mockTxQueryRaw,
  mockTxClaimFindMany,
  mockTxClaimCreate,
  mockTxClaimUpdateMany,
  mockTxPaymentCreate,
  mockAuditLogCreate,
  mockPaymentGroupBy,
  mockPaymentReversalGroupBy,
} = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockOrgMembershipFindFirst: vi.fn(),
  mockMemberFindFirst: vi.fn(),
  mockMembershipFindFirst: vi.fn(),
  mockClaimFindFirst: vi.fn(),
  mockClaimFindMany: vi.fn(),
  mockClaimCount: vi.fn(),
  mockTxQueryRaw: vi.fn(),
  mockTxClaimFindMany: vi.fn(),
  mockTxClaimCreate: vi.fn(),
  mockTxClaimUpdateMany: vi.fn(),
  mockTxPaymentCreate: vi.fn(),
  mockAuditLogCreate: vi.fn(),
  mockPaymentGroupBy: vi.fn(),
  mockPaymentReversalGroupBy: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({
  db: {
    organizationSubscription: { findUnique: vi.fn(async () => ({ suspendedAt: null, paidThroughAt: null, trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60_000) })) },
    organizationMembership: { findFirst: mockOrgMembershipFindFirst },
    member: { findFirst: mockMemberFindFirst },
    membership: { findFirst: mockMembershipFindFirst },
    paymentClaim: {
      findFirst: mockClaimFindFirst,
      findMany: mockClaimFindMany,
      count: mockClaimCount,
    },
    payment: { groupBy: mockPaymentGroupBy },
    paymentReversal: { groupBy: mockPaymentReversalGroupBy },
    $transaction: mockTransaction,
  },
}));

// The real getPrimaryMembership runs against the mocked db above; only
// the Clerk-touching auth module is stubbed out (same as payments.test.ts).
vi.mock("@/lib/server/auth", () => ({
  getCurrentUser: vi.fn(),
}));

import { PaymentValidationError } from "@/lib/members";
import {
  CLAIM_HISTORY_LIMIT,
  MAX_PENDING_CLAIMS_PER_MEMBERSHIP,
  PENDING_CLAIMS_QUEUE_LIMIT,
  PaymentClaimAuthorizationError,
  PaymentClaimConflictError,
  PaymentClaimDuplicateError,
  PaymentClaimLimitError,
  PaymentClaimNotFoundError,
  canVerifyPaymentClaim,
  confirmPaymentClaim,
  listClaimsForMember,
  listOwnPaymentClaims,
  listPendingClaimsForReview,
  rejectPaymentClaim,
  submitPaymentClaim,
  type MemberClaimScope,
} from "@/lib/server/payment-claims";

const STAFF_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_USER_ID = "22222222-2222-4222-8222-222222222222";
const ORG_ID = "33333333-3333-4333-8333-333333333333";
const MEMBER_ID = "44444444-4444-4444-8444-444444444444";
const MEMBERSHIP_ID = "55555555-5555-4555-8555-555555555555";
const CLAIM_ID = "66666666-6666-4666-8666-666666666666";
const PAYMENT_ID = "77777777-7777-4777-8777-777777777777";

const memberScope: MemberClaimScope = {
  userId: MEMBER_USER_ID,
  organizationId: ORG_ID,
  memberId: MEMBER_ID,
};

const VALID_INPUT = { amount: "6000", paymentMethod: "UPI", reference: "" };

function claimRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CLAIM_ID,
    memberId: MEMBER_ID,
    membershipId: MEMBERSHIP_ID,
    claimedAmount: new Prisma.Decimal("6000.00"),
    paymentMethod: "UPI",
    reference: null,
    status: "PENDING",
    ...overrides,
  };
}

function staffMembership(role: string) {
  return {
    id: "membership-row",
    userId: STAFF_ID,
    organizationId: ORG_ID,
    role,
    createdAt: new Date(),
    organization: { id: ORG_ID, name: "Gym" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOrgMembershipFindFirst.mockResolvedValue(staffMembership("OWNER"));
  mockMemberFindFirst.mockResolvedValue({ id: MEMBER_ID });
  mockMembershipFindFirst.mockResolvedValue({ id: MEMBERSHIP_ID });
  // Default: the in-transaction verifier revalidation finds the OWNER
  // membership row for the staff scope (submit's membership-row lock
  // ignores the result shape).
  mockTxQueryRaw.mockResolvedValue([{ organizationId: ORG_ID, role: "OWNER" }]);
  mockTxClaimFindMany.mockResolvedValue([]);
  mockTxClaimCreate.mockResolvedValue({ id: CLAIM_ID });
  mockTxClaimUpdateMany.mockResolvedValue({ count: 1 });
  mockTxPaymentCreate.mockResolvedValue({ id: PAYMENT_ID });
  mockAuditLogCreate.mockResolvedValue({ id: "audit-id" });
  mockPaymentGroupBy.mockResolvedValue([]);
  mockPaymentReversalGroupBy.mockResolvedValue([]);
  mockClaimCount.mockResolvedValue(0);
  mockTransaction.mockImplementation(async (cb: never) =>
    (cb as (tx: unknown) => Promise<unknown>)({
      organizationSubscription: { findUnique: async () => ({ suspendedAt: null, paidThroughAt: null, trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60_000) }) },
      $queryRaw: mockTxQueryRaw,
      paymentClaim: {
        findMany: mockTxClaimFindMany,
        create: mockTxClaimCreate,
        updateMany: mockTxClaimUpdateMany,
      },
      payment: { create: mockTxPaymentCreate },
      auditLog: { create: mockAuditLogCreate },
    }),
  );
});

describe("canVerifyPaymentClaim", () => {
  it("allows OWNER, ADMIN and STAFF only", () => {
    expect(canVerifyPaymentClaim("OWNER")).toBe(true);
    expect(canVerifyPaymentClaim("ADMIN")).toBe(true);
    expect(canVerifyPaymentClaim("STAFF")).toBe(true);
    expect(canVerifyPaymentClaim("TRAINER")).toBe(false);
    expect(canVerifyPaymentClaim("MEMBER")).toBe(false);
  });
});

describe("submitPaymentClaim", () => {
  it("creates the claim against the latest membership and audits it", async () => {
    const result = await submitPaymentClaim(memberScope, VALID_INPUT);
    expect(result).toEqual({ claimId: CLAIM_ID });

    const createArg = mockTxClaimCreate.mock.calls[0]?.[0];
    expect(createArg.data.organizationId).toBe(ORG_ID);
    expect(createArg.data.memberId).toBe(MEMBER_ID);
    expect(createArg.data.membershipId).toBe(MEMBERSHIP_ID);
    expect(createArg.data.claimedAmount.toString()).toBe("6000");
    expect(createArg.data.paymentMethod).toBe("UPI");
    expect(createArg.data.reference).toBeNull();

    // The membership row lock runs inside the transaction.
    expect(mockTxQueryRaw).toHaveBeenCalledTimes(1);
    // Submission is audited as the member, in the same transaction.
    expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
    const auditArg = mockAuditLogCreate.mock.calls[0]?.[0];
    expect(auditArg.data.event).toBe("PAYMENT_CLAIM_SUBMITTED");
    expect(auditArg.data.actorUserId).toBe(MEMBER_USER_ID);
    expect(auditArg.data.targetId).toBe(CLAIM_ID);
  });

  it("rejects invalid input before touching the database", async () => {
    await expect(
      submitPaymentClaim(memberScope, { ...VALID_INPUT, amount: "0" }),
    ).rejects.toBeInstanceOf(PaymentValidationError);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("requires a complete member scope", async () => {
    await expect(
      submitPaymentClaim({ ...memberScope, memberId: "" }, VALID_INPUT),
    ).rejects.toBeInstanceOf(PaymentClaimAuthorizationError);
  });

  it("treats a member from another gym as not found", async () => {
    mockMemberFindFirst.mockResolvedValue(null);
    await expect(
      submitPaymentClaim(memberScope, VALID_INPUT),
    ).rejects.toBeInstanceOf(PaymentClaimNotFoundError);
  });

  it("fails when the member has no membership to pay against", async () => {
    mockMembershipFindFirst.mockResolvedValue(null);
    await expect(
      submitPaymentClaim(memberScope, VALID_INPUT),
    ).rejects.toThrow("no membership to pay against");
  });

  it("blocks an exact duplicate pending claim", async () => {
    mockTxClaimFindMany.mockResolvedValue([
      {
        claimedAmount: new Prisma.Decimal("6000.00"),
        paymentMethod: "UPI",
        reference: null,
      },
    ]);
    await expect(
      submitPaymentClaim(memberScope, VALID_INPUT),
    ).rejects.toBeInstanceOf(PaymentClaimDuplicateError);
    expect(mockTxClaimCreate).not.toHaveBeenCalled();
  });

  it("does not treat a different amount or reference as a duplicate", async () => {
    mockTxClaimFindMany.mockResolvedValue([
      {
        claimedAmount: new Prisma.Decimal("500.00"),
        paymentMethod: "UPI",
        reference: null,
      },
    ]);
    await expect(
      submitPaymentClaim(memberScope, VALID_INPUT),
    ).resolves.toEqual({ claimId: CLAIM_ID });
  });

  it("enforces the pending cap", async () => {
    mockTxClaimFindMany.mockResolvedValue(
      Array.from({ length: MAX_PENDING_CLAIMS_PER_MEMBERSHIP }, (_, i) => ({
        claimedAmount: new Prisma.Decimal(`${100 + i}.00`),
        paymentMethod: "CASH",
        reference: null,
      })),
    );
    await expect(
      submitPaymentClaim(memberScope, VALID_INPUT),
    ).rejects.toBeInstanceOf(PaymentClaimLimitError);
    expect(mockTxClaimCreate).not.toHaveBeenCalled();
  });

  it("maps a unique-index race (P2002) to the duplicate error", async () => {
    mockTxClaimCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    await expect(
      submitPaymentClaim(memberScope, VALID_INPUT),
    ).rejects.toBeInstanceOf(PaymentClaimDuplicateError);
  });
});

describe("listOwnPaymentClaims", () => {
  it("returns the member's claims mapped to views, scoped to the gym", async () => {
    mockClaimFindMany.mockResolvedValue([
      {
        ...claimRow(),
        organizationId: ORG_ID,
        createdAt: new Date("2026-10-11T10:00:00.000Z"),
        verifiedAt: null,
        payment: null,
      },
      {
        ...claimRow({
          id: "88888888-8888-4888-8888-888888888888",
          status: "CONFIRMED",
          reference: "UTR123",
        }),
        organizationId: ORG_ID,
        createdAt: new Date("2026-10-01T10:00:00.000Z"),
        verifiedAt: new Date("2026-10-02T10:00:00.000Z"),
        payment: { id: PAYMENT_ID, amount: new Prisma.Decimal("5500.00") },
      },
    ]);
    const views = await listOwnPaymentClaims(memberScope);
    expect(mockClaimFindMany.mock.calls[0]?.[0].where).toEqual({
      organizationId: ORG_ID,
      memberId: MEMBER_ID,
    });
    expect(views[0]).toMatchObject({
      claimedAmountPaise: 600000,
      status: "PENDING",
      paymentId: null,
      confirmedAmountPaise: null,
    });
    expect(views[1]).toMatchObject({
      status: "CONFIRMED",
      paymentId: PAYMENT_ID,
      confirmedAmountPaise: 550000,
    });
  });
});

function reviewRow(overrides: Record<string, unknown> = {}) {
  return {
    ...claimRow(),
    createdAt: new Date("2026-10-11T09:00:00.000Z"),
    verifiedAt: null,
    payment: null,
    member: { name: "Asha Rao", phoneNumber: "9000000021" },
    membership: {
      plan: "MONTHLY",
      fee: new Prisma.Decimal("1000"),
      expiryDate: new Date("2026-02-01T00:00:00.000Z"),
    },
    ...overrides,
  };
}

describe("listPendingClaimsForReview", () => {
  it("denies roles that cannot verify claims", async () => {
    mockOrgMembershipFindFirst.mockResolvedValue(staffMembership("TRAINER"));
    await expect(
      listPendingClaimsForReview(STAFF_ID),
    ).rejects.toBeInstanceOf(PaymentClaimAuthorizationError);
    expect(mockClaimFindMany).not.toHaveBeenCalled();
    expect(mockClaimCount).not.toHaveBeenCalled();
  });

  it("queries only the actor's gym pending claims, oldest first, with display fields", async () => {
    mockClaimFindMany.mockResolvedValue([]);
    await listPendingClaimsForReview(STAFF_ID);
    const arg = mockClaimFindMany.mock.calls[0]?.[0];
    expect(arg.where).toEqual({ organizationId: ORG_ID, status: "PENDING" });
    expect(arg.orderBy).toEqual({ createdAt: "asc" });
    expect(arg.take).toBe(PENDING_CLAIMS_QUEUE_LIMIT);
    expect(arg.include.member.select).toEqual({
      name: true,
      phoneNumber: true,
    });
    expect(arg.include.membership.select).toEqual({
      plan: true,
      fee: true,
      expiryDate: true,
    });
    // The exact total comes from a count over the same scoped filter.
    const countArg = mockClaimCount.mock.calls[0]?.[0];
    expect(countArg.where).toEqual({
      organizationId: ORG_ID,
      status: "PENDING",
    });
  });

  it("bounds the displayed queue at the limit while reporting the exact pending total", async () => {
    mockClaimCount.mockResolvedValue(137);
    mockClaimFindMany.mockResolvedValue(
      Array.from({ length: PENDING_CLAIMS_QUEUE_LIMIT }, (_, i) =>
        reviewRow({ id: `claim-${i}` }),
      ),
    );
    const result = await listPendingClaimsForReview(STAFF_ID);
    expect(result.claims).toHaveLength(PENDING_CLAIMS_QUEUE_LIMIT);
    expect(result.totalPending).toBe(137);
    expect(mockClaimFindMany.mock.calls[0]?.[0].take).toBe(
      PENDING_CLAIMS_QUEUE_LIMIT,
    );
    // Balance sums are computed for the displayed claims' memberships
    // only — never for the unbounded queue behind them.
    const groupArg = mockPaymentGroupBy.mock.calls[0]?.[0];
    expect(groupArg.where.membershipId).toEqual({ in: [MEMBERSHIP_ID] });
  });

  it("maps member/membership display fields and confirmed-only balance context in one grouped sum", async () => {
    const OTHER_MEMBERSHIP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    mockClaimFindMany.mockResolvedValue([
      reviewRow(),
      reviewRow({
        id: "88888888-8888-4888-8888-888888888888",
        membershipId: OTHER_MEMBERSHIP,
        member: { name: "Ravi Shah", phoneNumber: "9000000022" },
        membership: {
          plan: "QUARTERLY",
          fee: new Prisma.Decimal("2500"),
          expiryDate: new Date("2026-04-01T00:00:00.000Z"),
        },
      }),
    ]);
    mockPaymentGroupBy.mockResolvedValue([
      {
        membershipId: MEMBERSHIP_ID,
        _sum: { amount: new Prisma.Decimal("400") },
      },
    ]);
    mockClaimCount.mockResolvedValue(2);

    const { claims: views, totalPending } =
      await listPendingClaimsForReview(STAFF_ID);

    expect(totalPending).toBe(2);
    expect(mockPaymentGroupBy).toHaveBeenCalledTimes(1);
    expect(views).toHaveLength(2);
    expect(views[0]).toMatchObject({
      memberName: "Asha Rao",
      memberPhoneNumber: "9000000021",
      membershipPlan: "MONTHLY",
      membershipFeePaise: 100_000,
      membershipExpiryDate: "2026-02-01T00:00:00.000Z",
      paidPaise: 40_000,
      outstandingPaise: 60_000,
      claimedAmountPaise: 600_000,
      status: "PENDING",
    });
    // No confirmed payments for the second membership: paid stays 0
    // and the pending claim itself is never counted as paid.
    expect(views[1]).toMatchObject({
      memberName: "Ravi Shah",
      membershipPlan: "QUARTERLY",
      membershipFeePaise: 250_000,
      paidPaise: 0,
      outstandingPaise: 250_000,
    });
  });

  it("leaves the existing PaymentClaimView shape untouched for member reads", async () => {
    mockClaimFindMany.mockResolvedValue([
      {
        ...claimRow(),
        organizationId: ORG_ID,
        createdAt: new Date("2026-10-11T09:00:00.000Z"),
        verifiedAt: null,
        payment: null,
      },
    ]);
    const views = await listOwnPaymentClaims(memberScope);
    expect(views[0]).not.toHaveProperty("memberName");
    expect(views[0]).not.toHaveProperty("paidPaise");
  });
});

describe("listClaimsForMember", () => {
  it("denies roles that cannot verify claims", async () => {
    mockOrgMembershipFindFirst.mockResolvedValue(staffMembership("TRAINER"));
    await expect(
      listClaimsForMember(STAFF_ID, MEMBER_ID),
    ).rejects.toBeInstanceOf(PaymentClaimAuthorizationError);
    expect(mockClaimFindMany).not.toHaveBeenCalled();
  });

  it("returns the member's claims newest first across statuses", async () => {
    mockClaimFindMany.mockResolvedValue([
      {
        ...claimRow({ status: "CONFIRMED" }),
        organizationId: ORG_ID,
        createdAt: new Date("2026-10-12T09:00:00.000Z"),
        verifiedAt: new Date("2026-10-12T10:00:00.000Z"),
        payment: { id: PAYMENT_ID, amount: new Prisma.Decimal("6000.00") },
      },
      {
        ...claimRow(),
        organizationId: ORG_ID,
        createdAt: new Date("2026-10-11T09:00:00.000Z"),
        verifiedAt: null,
        payment: null,
      },
    ]);
    const result = await listClaimsForMember(STAFF_ID, MEMBER_ID);
    const views = result.items;
    const memberArg = mockMemberFindFirst.mock.calls.at(-1)?.[0];
    expect(memberArg.where).toEqual({ id: MEMBER_ID, organizationId: ORG_ID });
    const claimArg = mockClaimFindMany.mock.calls[0]?.[0];
    expect(claimArg.where).toEqual({
      organizationId: ORG_ID,
      memberId: MEMBER_ID,
    });
    expect(claimArg.orderBy).toEqual({ createdAt: "desc" });
    expect(claimArg.take).toBe(CLAIM_HISTORY_LIMIT + 1);
    expect(result.truncated).toBe(false);
    expect(views.map((view) => view.status)).toEqual(["CONFIRMED", "PENDING"]);
    expect(views[0]?.confirmedAmountPaise).toBe(600_000);
  });

  it("caps the history at the limit and flags truncation via the probe row", async () => {
    mockClaimFindMany.mockResolvedValue(
      Array.from({ length: CLAIM_HISTORY_LIMIT + 1 }, () => ({
        ...claimRow(),
        organizationId: ORG_ID,
        createdAt: new Date("2026-10-11T09:00:00.000Z"),
        verifiedAt: null,
        payment: null,
      })),
    );
    const result = await listClaimsForMember(STAFF_ID, MEMBER_ID);
    expect(result.items).toHaveLength(CLAIM_HISTORY_LIMIT);
    expect(result.truncated).toBe(true);
    expect(mockClaimFindMany.mock.calls[0]?.[0].take).toBe(
      CLAIM_HISTORY_LIMIT + 1,
    );
  });

  it("treats foreign and nonexistent members identically as not found", async () => {
    mockMemberFindFirst.mockResolvedValue(null);
    const foreign = await listClaimsForMember(STAFF_ID, MEMBER_ID).catch(
      (error: unknown) => error,
    );
    const missing = await listClaimsForMember(
      STAFF_ID,
      "99999999-9999-4999-8999-999999999999",
    ).catch((error: unknown) => error);
    expect(foreign).toBeInstanceOf(PaymentClaimNotFoundError);
    expect(missing).toBeInstanceOf(PaymentClaimNotFoundError);
    expect((foreign as Error).message).toBe((missing as Error).message);
    expect(mockClaimFindMany).not.toHaveBeenCalled();
  });
});

describe("confirmPaymentClaim", () => {
  beforeEach(() => {
    mockClaimFindFirst.mockResolvedValue(claimRow());
  });

  it("transitions the claim and creates exactly one linked payment", async () => {
    const result = await confirmPaymentClaim(STAFF_ID, CLAIM_ID);
    expect(result).toEqual({ claimId: CLAIM_ID, paymentId: PAYMENT_ID });

    const transitionArg = mockTxClaimUpdateMany.mock.calls[0]?.[0];
    expect(transitionArg.where).toMatchObject({
      id: CLAIM_ID,
      organizationId: ORG_ID,
      status: "PENDING",
    });
    expect(transitionArg.data.status).toBe("CONFIRMED");
    expect(transitionArg.data.verifiedBy).toBe(STAFF_ID);

    const paymentArg = mockTxPaymentCreate.mock.calls[0]?.[0];
    expect(paymentArg.data.paymentClaimId).toBe(CLAIM_ID);
    expect(paymentArg.data.amount.toString()).toBe("6000");
    expect(paymentArg.data.paymentMethod).toBe("UPI");
    expect(paymentArg.data.confirmedBy).toBe(STAFF_ID);

    const events = mockAuditLogCreate.mock.calls.map(
      (call) => call[0].data.event,
    );
    expect(events).toEqual(["PAYMENT_CLAIM_CONFIRMED", "PAYMENT_CONFIRMED"]);
    const paymentAudit = mockAuditLogCreate.mock.calls[1]?.[0];
    expect(paymentAudit.data.targetId).toBe(PAYMENT_ID);
    expect(paymentAudit.data.metadata.paymentClaimId).toBe(CLAIM_ID);
  });

  it("confirms a different amount actually received when staff enter one", async () => {
    await confirmPaymentClaim(STAFF_ID, CLAIM_ID, { amount: "2500.50" });
    const paymentArg = mockTxPaymentCreate.mock.calls[0]?.[0];
    expect(paymentArg.data.amount.toString()).toBe("2500.5");
    const claimAudit = mockAuditLogCreate.mock.calls[0]?.[0];
    expect(claimAudit.data.metadata.claimedAmountPaise).toBe(600000);
    expect(claimAudit.data.metadata.confirmedAmountPaise).toBe(250050);
  });

  it("rejects an invalid override amount before any write", async () => {
    await expect(
      confirmPaymentClaim(STAFF_ID, CLAIM_ID, { amount: "-5" }),
    ).rejects.toBeInstanceOf(PaymentValidationError);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("conflicts when the claim was already decided (lost race)", async () => {
    mockTxClaimUpdateMany.mockResolvedValue({ count: 0 });
    await expect(confirmPaymentClaim(STAFF_ID, CLAIM_ID)).rejects.toBeInstanceOf(
      PaymentClaimConflictError,
    );
    expect(mockTxPaymentCreate).not.toHaveBeenCalled();
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });

  it("treats a claim from another gym as not found", async () => {
    mockClaimFindFirst.mockResolvedValue(null);
    await expect(confirmPaymentClaim(STAFF_ID, CLAIM_ID)).rejects.toBeInstanceOf(
      PaymentClaimNotFoundError,
    );
    expect(mockClaimFindFirst.mock.calls[0]?.[0].where).toEqual({
      id: CLAIM_ID,
      organizationId: ORG_ID,
    });
  });

  it("denies TRAINER before loading the claim", async () => {
    mockOrgMembershipFindFirst.mockResolvedValue(staffMembership("TRAINER"));
    await expect(confirmPaymentClaim(STAFF_ID, CLAIM_ID)).rejects.toBeInstanceOf(
      PaymentClaimAuthorizationError,
    );
    expect(mockClaimFindFirst).not.toHaveBeenCalled();
  });

  it("denies inside the transaction when the verifier's membership is gone", async () => {
    // Scope resolved fine moments ago, but the locked revalidation
    // finds no membership row: a mid-request removal must not confirm.
    mockTxQueryRaw.mockResolvedValue([]);
    await expect(confirmPaymentClaim(STAFF_ID, CLAIM_ID)).rejects.toBeInstanceOf(
      PaymentClaimAuthorizationError,
    );
    expect(mockTxClaimUpdateMany).not.toHaveBeenCalled();
    expect(mockTxPaymentCreate).not.toHaveBeenCalled();
  });

  it("denies inside the transaction when the verifier was demoted mid-request", async () => {
    mockTxQueryRaw.mockResolvedValue([
      { organizationId: ORG_ID, role: "TRAINER" },
    ]);
    await expect(confirmPaymentClaim(STAFF_ID, CLAIM_ID)).rejects.toBeInstanceOf(
      PaymentClaimAuthorizationError,
    );
    expect(mockTxClaimUpdateMany).not.toHaveBeenCalled();
    expect(mockTxPaymentCreate).not.toHaveBeenCalled();
  });

  it("denies inside the transaction when the verifier's primary gym changed", async () => {
    mockTxQueryRaw.mockResolvedValue([
      { organizationId: "99999999-9999-4999-8999-999999999999", role: "OWNER" },
    ]);
    await expect(confirmPaymentClaim(STAFF_ID, CLAIM_ID)).rejects.toBeInstanceOf(
      PaymentClaimAuthorizationError,
    );
    expect(mockTxClaimUpdateMany).not.toHaveBeenCalled();
  });
});

describe("rejectPaymentClaim", () => {
  beforeEach(() => {
    mockClaimFindFirst.mockResolvedValue(claimRow());
  });

  it("transitions to REJECTED with an audit event and no payment", async () => {
    const result = await rejectPaymentClaim(STAFF_ID, CLAIM_ID);
    expect(result).toEqual({ claimId: CLAIM_ID });
    const transitionArg = mockTxClaimUpdateMany.mock.calls[0]?.[0];
    expect(transitionArg.data.status).toBe("REJECTED");
    expect(transitionArg.data.verifiedBy).toBe(STAFF_ID);
    expect(mockTxPaymentCreate).not.toHaveBeenCalled();
    expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
    expect(mockAuditLogCreate.mock.calls[0]?.[0].data.event).toBe(
      "PAYMENT_CLAIM_REJECTED",
    );
  });

  it("conflicts when the claim was already decided", async () => {
    mockTxClaimUpdateMany.mockResolvedValue({ count: 0 });
    await expect(rejectPaymentClaim(STAFF_ID, CLAIM_ID)).rejects.toBeInstanceOf(
      PaymentClaimConflictError,
    );
  });

  it("treats a claim from another gym as not found", async () => {
    mockClaimFindFirst.mockResolvedValue(null);
    await expect(rejectPaymentClaim(STAFF_ID, CLAIM_ID)).rejects.toBeInstanceOf(
      PaymentClaimNotFoundError,
    );
  });

  it("denies inside the transaction when the verifier's membership is gone", async () => {
    mockTxQueryRaw.mockResolvedValue([]);
    await expect(rejectPaymentClaim(STAFF_ID, CLAIM_ID)).rejects.toBeInstanceOf(
      PaymentClaimAuthorizationError,
    );
    expect(mockTxClaimUpdateMany).not.toHaveBeenCalled();
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });
});
