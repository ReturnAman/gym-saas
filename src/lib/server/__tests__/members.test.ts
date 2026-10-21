import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const {
  mockTransaction,
  mockOrgMembershipFindFirst,
  mockOrgMembershipFindMany,
  mockMemberFindMany,
  mockMemberFindFirst,
  mockMemberCreate,
  mockMemberUpdate,
  mockMemberCount,
  mockMembershipCreate,
  mockPaymentGroupBy,
  mockPaymentFindMany,
  mockPaymentReversalGroupBy,
  mockPaymentReversalFindMany,
} = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockOrgMembershipFindFirst: vi.fn(),
  mockOrgMembershipFindMany: vi.fn(),
  mockMemberFindMany: vi.fn(),
  mockMemberFindFirst: vi.fn(),
  mockMemberCreate: vi.fn(),
  mockMemberUpdate: vi.fn(),
  mockMemberCount: vi.fn(),
  mockMembershipCreate: vi.fn(),
  mockPaymentGroupBy: vi.fn(),
  mockPaymentFindMany: vi.fn(),
  mockPaymentReversalGroupBy: vi.fn(),
  mockPaymentReversalFindMany: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({
  db: {
    organizationMembership: {
      findFirst: mockOrgMembershipFindFirst,
      findMany: mockOrgMembershipFindMany,
    },
    member: {
      findMany: mockMemberFindMany,
      findFirst: mockMemberFindFirst,
      create: mockMemberCreate,
      update: mockMemberUpdate,
      count: mockMemberCount,
    },
    payment: { groupBy: mockPaymentGroupBy, findMany: mockPaymentFindMany },
    paymentReversal: {
      groupBy: mockPaymentReversalGroupBy,
      findMany: mockPaymentReversalFindMany,
    },
    $transaction: mockTransaction,
  },
}));

// The real getPrimaryMembership runs against the mocked db above; only the
// Clerk-touching auth module is stubbed out.
vi.mock("@/lib/server/auth", () => ({
  getCurrentUser: vi.fn(),
}));

import { MemberValidationError } from "@/lib/members";
import {
  MemberAuthorizationError,
  MemberDuplicateError,
  MemberNotFoundError,
  createMemberWithMembership,
  getMemberDetail,
  getMemberPermissions,
  listMembers,
  updateMember,
} from "@/lib/server/members";

const USER_ID = "b2198c2a-f96e-22da-cd1a-00222444be2e";
const ORG_ID = "c3298d3b-a07f-33eb-de2b-00333455cf3f";
const MEMBER_ID = "f65a9b4e-d21c-44de-bc3d-00666788ef4f";

const VALID_INPUT = {
  name: "Rahul Sharma",
  phoneNumber: "9876543210",
  fee: "6000",
  plan: "SIX_MONTHS",
  startDate: "2026-08-01",
};

function mockOwnerScope() {
  mockOrgMembershipFindFirst.mockResolvedValue({
    userId: USER_ID,
    organizationId: ORG_ID,
    role: "OWNER",
  });
}

function mockRoleScope(role: string) {
  mockOrgMembershipFindFirst.mockResolvedValue({
    userId: USER_ID,
    organizationId: ORG_ID,
    role,
  });
}

function mockSuccessfulCreate() {
  mockMemberFindMany.mockResolvedValue([]);
  mockMemberCreate.mockResolvedValue({ id: MEMBER_ID });
  mockMembershipCreate.mockResolvedValue({ id: "membership-id" });
  mockTransaction.mockImplementation(async (cb: never) =>
    (cb as (tx: unknown) => Promise<unknown>)({
      // The member-decision advisory lock is a no-op in this mock:
      // these tests pin validation/authorization behaviour, and the
      // lock's serialization is covered on a real database.
      $executeRaw: async () => 1,
      member: { create: mockMemberCreate, findMany: mockMemberFindMany },
      membership: { create: mockMembershipCreate },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOwnerScope();
  // Default: no confirmed payments anywhere (sums derive paid = ₹0).
  mockPaymentGroupBy.mockResolvedValue([]);
  mockPaymentFindMany.mockResolvedValue([]);
  mockPaymentReversalGroupBy.mockResolvedValue([]);
  mockPaymentReversalFindMany.mockResolvedValue([]);
  mockOrgMembershipFindMany.mockResolvedValue([]);
});

describe("getMemberPermissions", () => {
  it("lets OWNER and ADMIN manage members and reverse payments", () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      expect(getMemberPermissions(role)).toEqual({
        canView: true,
        canCreate: true,
        canEdit: true,
        canRecordPayment: true,
        canReversePayment: true,
      });
    }
  });

  it("lets STAFF manage members and record payments, but not reverse them", () => {
    expect(getMemberPermissions("STAFF")).toEqual({
      canView: true,
      canCreate: true,
      canEdit: true,
      canRecordPayment: true,
      canReversePayment: false,
    });
  });

  it("lets TRAINER view but not mutate", () => {
    expect(getMemberPermissions("TRAINER")).toEqual({
      canView: true,
      canCreate: false,
      canEdit: false,
      canRecordPayment: false,
      canReversePayment: false,
    });
  });

  it("gives MEMBER no management rights (own-only scoping is separate)", () => {
    expect(getMemberPermissions("MEMBER")).toEqual({
      canView: false,
      canCreate: false,
      canEdit: false,
      canRecordPayment: false,
      canReversePayment: false,
    });
  });
});

describe("createMemberWithMembership", () => {
  it("creates the member and membership atomically with exact money", async () => {
    mockSuccessfulCreate();

    const { memberId } = await createMemberWithMembership(USER_ID, VALID_INPUT);

    expect(memberId).toBe(MEMBER_ID);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockMemberCreate).toHaveBeenCalledWith({
      data: {
        organizationId: ORG_ID,
        name: "Rahul Sharma",
        phoneNumber: "9876543210",
      },
      select: { id: true },
    });
    const membershipData = mockMembershipCreate.mock.calls[0]?.[0].data;
    expect(membershipData.organizationId).toBe(ORG_ID);
    expect(membershipData.memberId).toBe(MEMBER_ID);
    expect(membershipData.plan).toBe("SIX_MONTHS");
    expect(membershipData.startDate).toEqual(new Date(Date.UTC(2026, 7, 1)));
    expect(membershipData.expiryDate).toEqual(new Date(Date.UTC(2027, 1, 1)));
    // Exact Decimal from integer paise — never floating point.
    expect(membershipData.fee).toBeInstanceOf(Prisma.Decimal);
    expect(membershipData.fee.toString()).toBe("6000");
    // No persisted payment balance: paid/outstanding are derived, so the
    // create payload must not carry a paid amount at all.
    expect(membershipData).not.toHaveProperty("paidAmount");
  });

  it.each(["TRAINER", "MEMBER"])(
    "refuses creation for role %s without touching the database",
    async (role) => {
      mockRoleScope(role);
      await expect(
        createMemberWithMembership(USER_ID, VALID_INPUT),
      ).rejects.toBeInstanceOf(MemberAuthorizationError);
      expect(mockTransaction).not.toHaveBeenCalled();
      expect(mockMemberFindMany).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid input before any duplicate check or write", async () => {
    await expect(
      createMemberWithMembership(USER_ID, { ...VALID_INPUT, phoneNumber: "+919876543210" }),
    ).rejects.toBeInstanceOf(MemberValidationError);
    expect(mockMemberFindMany).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("holds creation back when the phone number is already in use", async () => {
    // The duplicate check runs inside the transaction, under the
    // member-decision advisory lock, so it observes members committed
    // by racing creations/approvals. Throwing there still writes
    // nothing: neither the member nor the membership is created.
    const duplicates = [
      { id: "other-id", name: "Rahul S", phoneNumber: "9876543210" },
    ];
    mockSuccessfulCreate();
    mockMemberFindMany.mockResolvedValue(duplicates);

    const error = await createMemberWithMembership(USER_ID, VALID_INPUT).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(MemberDuplicateError);
    expect((error as MemberDuplicateError).duplicates).toEqual(duplicates);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockMemberCreate).not.toHaveBeenCalled();
    expect(mockMembershipCreate).not.toHaveBeenCalled();
  });

  it("creates anyway when the duplicate is explicitly acknowledged", async () => {
    // allowDuplicate skips the duplicate lookup entirely — the user already
    // saw the conflict and decided to keep both records.
    mockSuccessfulCreate();

    const { memberId } = await createMemberWithMembership(USER_ID, VALID_INPUT, {
      allowDuplicate: true,
    });
    expect(memberId).toBe(MEMBER_ID);
    expect(mockMemberFindMany).not.toHaveBeenCalled();
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("requires authentication", async () => {
    await expect(createMemberWithMembership("", VALID_INPUT)).rejects.toThrow(
      /authentication/i,
    );
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("requires organization membership", async () => {
    mockOrgMembershipFindFirst.mockResolvedValue(null);
    await expect(
      createMemberWithMembership(USER_ID, VALID_INPUT),
    ).rejects.toThrow(/organization/i);
  });
});

describe("listMembers", () => {
  function mockEmptyList() {
    mockMemberCount.mockResolvedValue(0);
    mockMemberFindMany.mockResolvedValue([]);
  }

  it("always scopes queries to the caller's organization", async () => {
    mockEmptyList();
    await listMembers(USER_ID, { search: "rahul" });
    const where = mockMemberFindMany.mock.calls[0]?.[0].where;
    expect(where.organizationId).toBe(ORG_ID);
    expect(where.OR).toBeDefined();
    expect(mockMemberCount.mock.calls[0]?.[0].where.organizationId).toBe(ORG_ID);
  });

  it("restricts MEMBER role to their own linked record", async () => {
    mockRoleScope("MEMBER");
    mockEmptyList();
    await listMembers(USER_ID, {});
    const where = mockMemberFindMany.mock.calls[0]?.[0].where;
    expect(where.organizationId).toBe(ORG_ID);
    expect(where.userId).toBe(USER_ID);
  });

  it("derives display fields from the latest membership", async () => {
    mockMemberCount.mockResolvedValue(1);
    mockMemberFindMany.mockResolvedValue([
      {
        id: MEMBER_ID,
        name: "Rahul Sharma",
        phoneNumber: "9876543210",
        memberships: [
          {
            plan: "MONTHLY",
            startDate: new Date(Date.UTC(2026, 8, 1)),
            expiryDate: new Date(Date.UTC(2099, 0, 1)),
            fee: new Prisma.Decimal("6000"),
          },
        ],
      },
    ]);

    const result = await listMembers(USER_ID, {});
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: MEMBER_ID,
      plan: "MONTHLY",
      planLabel: "Monthly",
      membershipStatus: "ACTIVE",
      paymentStatus: "UNPAID",
      feePaise: 600_000,
      paidPaise: 0,
      outstandingPaise: 600_000,
    });
  });
});

describe("getMemberDetail", () => {
  it("returns null for a member from another organization (no IDOR oracle)", async () => {
    mockMemberFindFirst.mockResolvedValue(null);
    const detail = await getMemberDetail(USER_ID, "other-org-member-id");
    expect(detail).toBeNull();
    expect(mockMemberFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "other-org-member-id", organizationId: ORG_ID },
      }),
    );
  });

  it("returns null when a MEMBER-role user asks for someone else's record", async () => {
    mockRoleScope("MEMBER");
    mockMemberFindFirst.mockResolvedValue({
      id: MEMBER_ID,
      name: "Someone Else",
      phoneNumber: "9000000000",
      userId: "different-user",
      memberships: [],
    });
    expect(await getMemberDetail(USER_ID, MEMBER_ID)).toBeNull();
  });
});

describe("payments derivation (list & detail)", () => {
  const MEMBERSHIP_ID = "d47a1c5b-8e3f-4a2b-9c1d-001122334455";

  function memberRow() {
    return {
      id: MEMBER_ID,
      name: "Rahul Sharma",
      phoneNumber: "9876543210",
      userId: null,
      memberships: [
        {
          id: MEMBERSHIP_ID,
          plan: "MONTHLY",
          startDate: new Date(Date.UTC(2026, 8, 1)),
          expiryDate: new Date(Date.UTC(2099, 0, 1)),
          fee: new Prisma.Decimal("6000"),
        },
      ],
    };
  }

  function mockPaidSum(rupees: string) {
    mockPaymentGroupBy.mockResolvedValue([
      { membershipId: MEMBERSHIP_ID, _sum: { amount: new Prisma.Decimal(rupees) } },
    ]);
  }

  it("derives PARTIALLY_PAID and outstanding from confirmed payment sums", async () => {
    mockMemberCount.mockResolvedValue(1);
    mockMemberFindMany.mockResolvedValue([memberRow()]);
    mockPaidSum("2500");

    const result = await listMembers(USER_ID, {});
    expect(result.items[0]).toMatchObject({
      paymentStatus: "PARTIALLY_PAID",
      paidPaise: 250_000,
      outstandingPaise: 350_000,
    });
    // Sums are always tenant-scoped.
    expect(mockPaymentGroupBy.mock.calls[0]?.[0].where.organizationId).toBe(ORG_ID);
  });

  it("derives OVERPAID when confirmed sums exceed the fee", async () => {
    mockMemberCount.mockResolvedValue(1);
    mockMemberFindMany.mockResolvedValue([memberRow()]);
    mockPaidSum("7000");

    const result = await listMembers(USER_ID, {});
    expect(result.items[0]).toMatchObject({
      paymentStatus: "OVERPAID",
      paidPaise: 700_000,
      // Outstanding floors at ₹0 on overpayment; the paid total remains
      // the actual confirmed sum (₹7,000 against a ₹6,000 fee).
      outstandingPaise: 0,
    });
  });

  it("makes the PARTIALLY_PAID list filter functional", async () => {
    mockMemberFindMany.mockResolvedValue([memberRow()]);
    mockPaidSum("2500");

    const partial = await listMembers(USER_ID, { paymentStatus: "PARTIALLY_PAID" });
    expect(partial.total).toBe(1);
    const paid = await listMembers(USER_ID, { paymentStatus: "PAID" });
    expect(paid.total).toBe(0);
    const unpaid = await listMembers(USER_ID, { paymentStatus: "UNPAID" });
    expect(unpaid.total).toBe(0);
  });

  it("returns payment history with the member detail", async () => {
    mockMemberFindFirst.mockResolvedValue(memberRow());
    mockPaidSum("2500");
    mockPaymentFindMany.mockResolvedValue([
      {
        id: "payment-id",
        amount: new Prisma.Decimal("2500"),
        paymentMethod: "UPI",
        reference: "UTR123",
        confirmedAt: new Date(Date.UTC(2026, 8, 15, 10, 30)),
        confirmedBy: USER_ID,
      },
    ]);
    mockOrgMembershipFindMany.mockResolvedValue([
      { userId: USER_ID, role: "OWNER" },
    ]);

    const detail = await getMemberDetail(USER_ID, MEMBER_ID);
    expect(detail?.membership).toMatchObject({
      paidPaise: 250_000,
      outstandingPaise: 350_000,
      paymentStatus: "PARTIALLY_PAID",
    });
    expect(detail?.membership?.payments).toEqual([
      {
        id: "payment-id",
        amountPaise: 250_000,
        paymentMethod: "UPI",
        reference: "UTR123",
        confirmedAt: new Date(Date.UTC(2026, 8, 15, 10, 30)).toISOString(),
        confirmedByRole: "OWNER",
        reversedPaise: 0,
        remainingReversiblePaise: 250_000,
      },
    ]);
    expect(detail?.membership?.reversals).toEqual([]);
    // History lookups are tenant-scoped too.
    expect(mockPaymentFindMany.mock.calls[0]?.[0].where).toEqual({
      organizationId: ORG_ID,
      membershipId: MEMBERSHIP_ID,
    });
  });
});

describe("updateMember", () => {  const UPDATE = { name: "Rahul S", phoneNumber: "9000000001" };

  function mockExistingMember() {
    mockMemberFindFirst.mockResolvedValue({ id: MEMBER_ID });
    mockMemberFindMany.mockResolvedValue([]);
    mockMemberUpdate.mockResolvedValue({ id: MEMBER_ID });
  }

  it("updates name and phone for an authorized role", async () => {
    mockExistingMember();
    await updateMember(USER_ID, MEMBER_ID, UPDATE);
    expect(mockMemberUpdate).toHaveBeenCalledWith({
      where: { id: MEMBER_ID },
      data: { name: "Rahul S", phoneNumber: "9000000001" },
    });
  });

  it.each(["TRAINER", "MEMBER"])(
    "refuses edits for role %s",
    async (role) => {
      mockRoleScope(role);
      await expect(updateMember(USER_ID, MEMBER_ID, UPDATE)).rejects.toBeInstanceOf(
        MemberAuthorizationError,
      );
      expect(mockMemberUpdate).not.toHaveBeenCalled();
    },
  );

  it("throws MemberNotFoundError for a missing or cross-org member", async () => {
    mockMemberFindFirst.mockResolvedValue(null);
    await expect(updateMember(USER_ID, MEMBER_ID, UPDATE)).rejects.toBeInstanceOf(
      MemberNotFoundError,
    );
    expect(mockMemberUpdate).not.toHaveBeenCalled();
  });

  it("validates input before writing", async () => {
    mockExistingMember();
    await expect(
      updateMember(USER_ID, MEMBER_ID, { name: "Rahul", phoneNumber: "123" }),
    ).rejects.toBeInstanceOf(MemberValidationError);
    expect(mockMemberUpdate).not.toHaveBeenCalled();
  });

  it("surfaces duplicate phones on edit instead of silently merging", async () => {
    mockExistingMember();
    mockMemberFindMany.mockResolvedValue([
      { id: "other-id", name: "Other", phoneNumber: "9000000001" },
    ]);
    await expect(updateMember(USER_ID, MEMBER_ID, UPDATE)).rejects.toBeInstanceOf(
      MemberDuplicateError,
    );
    expect(mockMemberUpdate).not.toHaveBeenCalled();
  });
});
