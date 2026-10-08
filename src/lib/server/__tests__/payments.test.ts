import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const {
  mockTransaction,
  mockOrgMembershipFindFirst,
  mockMemberFindFirst,
  mockMembershipFindFirst,
  mockPaymentCreate,
  mockAuditLogCreate,
  mockMembershipUpdate,
  mockPaymentGroupBy,
} = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockOrgMembershipFindFirst: vi.fn(),
  mockMemberFindFirst: vi.fn(),
  mockMembershipFindFirst: vi.fn(),
  mockPaymentCreate: vi.fn(),
  mockAuditLogCreate: vi.fn(),
  mockMembershipUpdate: vi.fn(),
  mockPaymentGroupBy: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({
  db: {
    organizationMembership: { findFirst: mockOrgMembershipFindFirst },
    member: { findFirst: mockMemberFindFirst },
    membership: { findFirst: mockMembershipFindFirst },
    payment: { groupBy: mockPaymentGroupBy },
    $transaction: mockTransaction,
  },
}));

// The real getPrimaryMembership runs against the mocked db above; only the
// Clerk-touching auth module is stubbed out.
vi.mock("@/lib/server/auth", () => ({
  getCurrentUser: vi.fn(),
}));

import { PaymentValidationError } from "@/lib/members";
import {
  PaymentAuthorizationError,
  PaymentNotFoundError,
  canRecordPayment,
  recordPayment,
  sumConfirmedPaymentsByMembership,
} from "@/lib/server/payments";

const USER_ID = "b2198c2a-f96e-22da-cd1a-00222444be2e";
const ORG_ID = "c3298d3b-a07f-33eb-de2b-00333455cf3f";
const MEMBER_ID = "f65a9b4e-d21c-44de-bc3d-00666788ef4f";
const MEMBERSHIP_ID = "d47a1c5b-8e3f-4a2b-9c1d-001122334455";
const PAYMENT_ID = "a12b3c4d-5e6f-47a8-b9c0-0a1b2c3d4e5f";

const VALID_PAYMENT = { amount: "2500.50", paymentMethod: "UPI", reference: "" };

function mockRoleScope(role: string) {
  mockOrgMembershipFindFirst.mockResolvedValue({
    userId: USER_ID,
    organizationId: ORG_ID,
    role,
  });
}

function mockMemberAndMembership() {
  mockMemberFindFirst.mockResolvedValue({ id: MEMBER_ID });
  mockMembershipFindFirst.mockResolvedValue({ id: MEMBERSHIP_ID });
  mockPaymentCreate.mockResolvedValue({ id: PAYMENT_ID });
  mockAuditLogCreate.mockResolvedValue({ id: "audit-id" });
  mockTransaction.mockImplementation(async (cb: never) =>
    (cb as (tx: unknown) => Promise<unknown>)({
      payment: { create: mockPaymentCreate },
      auditLog: { create: mockAuditLogCreate },
      membership: { update: mockMembershipUpdate },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRoleScope("OWNER");
});

describe("canRecordPayment", () => {
  it("allows OWNER, ADMIN and STAFF only", () => {
    for (const role of ["OWNER", "ADMIN", "STAFF"] as const) {
      expect(canRecordPayment(role)).toBe(true);
    }
    for (const role of ["TRAINER", "MEMBER"] as const) {
      expect(canRecordPayment(role)).toBe(false);
    }
  });
});

describe("recordPayment", () => {
  it.each(["OWNER", "ADMIN", "STAFF"])(
    "records a payment for role %s with its audit event in one transaction",
    async (role) => {
      mockRoleScope(role);
      mockMemberAndMembership();

      const { paymentId } = await recordPayment(USER_ID, MEMBER_ID, VALID_PAYMENT);
      expect(paymentId).toBe(PAYMENT_ID);

      // One transaction carrying both writes — payment + audit are atomic.
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockPaymentCreate).toHaveBeenCalledTimes(1);
      expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);

      const paymentData = mockPaymentCreate.mock.calls[0]?.[0].data;
      expect(paymentData.organizationId).toBe(ORG_ID);
      expect(paymentData.memberId).toBe(MEMBER_ID);
      expect(paymentData.membershipId).toBe(MEMBERSHIP_ID);
      // Exact Decimal from integer paise — never floating point.
      expect(paymentData.amount).toBeInstanceOf(Prisma.Decimal);
      expect(paymentData.amount.toString()).toBe("2500.5");
      expect(paymentData.paymentMethod).toBe("UPI");
      expect(paymentData.reference).toBeNull();
      expect(paymentData.confirmedBy).toBe(USER_ID);
      expect(paymentData.confirmedAt).toBeInstanceOf(Date);
      // No persisted balance is written anywhere.
      expect(paymentData).not.toHaveProperty("paidAmount");

      const auditData = mockAuditLogCreate.mock.calls[0]?.[0].data;
      expect(auditData).toMatchObject({
        organizationId: ORG_ID,
        actorUserId: USER_ID,
        event: "PAYMENT_CONFIRMED",
        targetType: "Payment",
        targetId: PAYMENT_ID,
      });
      expect(auditData.metadata).toMatchObject({
        memberId: MEMBER_ID,
        membershipId: MEMBERSHIP_ID,
        amountPaise: 250_050,
        paymentMethod: "UPI",
      });
    },
  );

  it.each(["TRAINER", "MEMBER"])(
    "refuses role %s without touching the database",
    async (role) => {
      mockRoleScope(role);
      await expect(
        recordPayment(USER_ID, MEMBER_ID, VALID_PAYMENT),
      ).rejects.toBeInstanceOf(PaymentAuthorizationError);
      expect(mockMemberFindFirst).not.toHaveBeenCalled();
      expect(mockTransaction).not.toHaveBeenCalled();
    },
  );

  it("treats a member from another organization as not found", async () => {
    // The lookup is scoped by the caller's organization, so a cross-tenant
    // member ID returns null — indistinguishable from a missing member.
    mockMemberFindFirst.mockResolvedValue(null);
    await expect(
      recordPayment(USER_ID, "other-org-member-id", VALID_PAYMENT),
    ).rejects.toBeInstanceOf(PaymentNotFoundError);
    expect(mockMemberFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "other-org-member-id", organizationId: ORG_ID },
      }),
    );
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("pays against the member's latest membership, looked up tenant-scoped", async () => {
    // The selected membership is deliberate: the member's most recently
    // created membership inside the caller's organization — never one from
    // another organization, never an older period.
    mockMemberAndMembership();
    await recordPayment(USER_ID, MEMBER_ID, VALID_PAYMENT);
    expect(mockMembershipFindFirst).toHaveBeenCalledWith({
      where: { memberId: MEMBER_ID, organizationId: ORG_ID },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    expect(mockPaymentCreate.mock.calls[0]?.[0].data.membershipId).toBe(
      MEMBERSHIP_ID,
    );
  });

  it("fails when the member has no membership to pay against", async () => {
    mockMemberFindFirst.mockResolvedValue({ id: MEMBER_ID });
    mockMembershipFindFirst.mockResolvedValue(null);
    await expect(
      recordPayment(USER_ID, MEMBER_ID, VALID_PAYMENT),
    ).rejects.toBeInstanceOf(PaymentNotFoundError);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects invalid input before any write", async () => {
    mockMemberAndMembership();
    for (const input of [
      { amount: "0", paymentMethod: "UPI", reference: "" },
      { amount: "abc", paymentMethod: "UPI", reference: "" },
      { amount: "100", paymentMethod: "CHEQUE", reference: "" },
    ]) {
      await expect(recordPayment(USER_ID, MEMBER_ID, input)).rejects.toBeInstanceOf(
        PaymentValidationError,
      );
    }
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("never modifies the membership (no renewal/extension/repricing)", async () => {
    mockMemberAndMembership();
    await recordPayment(USER_ID, MEMBER_ID, VALID_PAYMENT);
    expect(mockMembershipUpdate).not.toHaveBeenCalled();
  });

  it("keeps an optional reference when one is provided", async () => {
    mockMemberAndMembership();
    await recordPayment(USER_ID, MEMBER_ID, {
      amount: "100",
      paymentMethod: "UPI",
      reference: "UTR998877",
    });
    expect(mockPaymentCreate.mock.calls[0]?.[0].data.reference).toBe("UTR998877");
  });

  it("requires authentication and organization membership", async () => {
    await expect(recordPayment("", MEMBER_ID, VALID_PAYMENT)).rejects.toThrow(
      /authentication/i,
    );
    mockOrgMembershipFindFirst.mockResolvedValue(null);
    await expect(recordPayment(USER_ID, MEMBER_ID, VALID_PAYMENT)).rejects.toThrow(
      /organization/i,
    );
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

describe("sumConfirmedPaymentsByMembership", () => {
  it("sums confirmed payments per membership in exact paise, tenant-scoped", async () => {
    mockPaymentGroupBy.mockResolvedValue([
      { membershipId: MEMBERSHIP_ID, _sum: { amount: new Prisma.Decimal("2500.50") } },
    ]);
    const sums = await sumConfirmedPaymentsByMembership(ORG_ID, [MEMBERSHIP_ID]);
    expect(sums.get(MEMBERSHIP_ID)).toBe(250_050);
    expect(mockPaymentGroupBy.mock.calls[0]?.[0].where).toEqual({
      organizationId: ORG_ID,
      membershipId: { in: [MEMBERSHIP_ID] },
    });
  });

  it("returns an empty map without querying when there are no memberships", async () => {
    const sums = await sumConfirmedPaymentsByMembership(ORG_ID, []);
    expect(sums.size).toBe(0);
    expect(mockPaymentGroupBy).not.toHaveBeenCalled();
  });
});
