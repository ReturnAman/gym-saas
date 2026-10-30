import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * Membership renewal — service unit tests (mocked Prisma).
 *
 * Pins the renewal contract: chaining at the three boundaries,
 * defaults, validation, OWNER/ADMIN/STAFF-only authorization,
 * tenant-scoped not-found behavior, SaaS restriction, and the
 * token-replay semantics (identical retry resolves to the original;
 * conflicting reuse is rejected). Concurrency and cross-gym behavior
 * against a real database live in members-renewal-db.test.ts.
 */

const {
  mockTransaction,
  mockOrgMembershipFindFirst,
  mockMemberFindFirst,
  mockDbMembershipFindFirst,
  mockDbAuditFindFirst,
  mockTxMembershipFindFirst,
  mockTxAuditFindFirst,
  mockMembershipCreate,
  mockAuditCreate,
  mockSubscriptionFindUnique,
  mockTxSubscriptionFindUnique,
  mockExecuteRaw,
} = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockOrgMembershipFindFirst: vi.fn(),
  mockMemberFindFirst: vi.fn(),
  mockDbMembershipFindFirst: vi.fn(),
  mockDbAuditFindFirst: vi.fn(),
  mockTxMembershipFindFirst: vi.fn(),
  mockTxAuditFindFirst: vi.fn(),
  mockMembershipCreate: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockSubscriptionFindUnique: vi.fn(),
  mockTxSubscriptionFindUnique: vi.fn(),
  mockExecuteRaw: vi.fn(),
}));

const ENTITLED = {
  suspendedAt: null,
  paidThroughAt: null,
  trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
};

vi.mock("@/lib/server/db", () => ({
  db: {
    organizationMembership: { findFirst: mockOrgMembershipFindFirst },
    organizationSubscription: { findUnique: mockSubscriptionFindUnique },
    member: { findFirst: mockMemberFindFirst },
    membership: { findFirst: mockDbMembershipFindFirst },
    auditLog: { findFirst: mockDbAuditFindFirst },
    $transaction: mockTransaction,
  },
}));

vi.mock("@/lib/server/auth", () => ({
  getCurrentUser: vi.fn(),
}));

import { MemberValidationError } from "@/lib/members";
import {
  MemberAuthorizationError,
  MemberNotFoundError,
  MemberRenewalConflictError,
  getMemberPermissions,
  renewMembership,
} from "@/lib/server/members";
import { SubscriptionRestrictedError } from "@/lib/server/subscriptions";

const USER_ID = "b2198c2a-f96e-22da-cd1a-00222444be2e";
const ORG_ID = "c3298d3b-a07f-33eb-de2b-00333455cf3f";
const MEMBER_ID = "f65a9b4e-d21c-44de-bc3d-00666788ef4f";
const CURRENT_MEMBERSHIP_ID = "a15a9c4e-d21c-44de-bc3d-00666788ef501";
const NEW_MEMBERSHIP_ID = "a25a9c4e-d21c-44de-bc3d-00666788ef502";
const TOKEN = "550e8400-e29b-41d4-a716-446655440000";

function utcDay(offsetDays: number): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) +
      offsetDays * 86_400_000,
  );
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function currentMembership(expiryDate: Date) {
  return {
    id: CURRENT_MEMBERSHIP_ID,
    plan: "SIX_MONTHS" as const,
    fee: new Prisma.Decimal("6000.00"),
    expiryDate,
  };
}

function mockScope(role: string) {
  mockOrgMembershipFindFirst.mockResolvedValue({
    userId: USER_ID,
    organizationId: ORG_ID,
    role,
  });
}

/** Row returned for the in-transaction TOKEN lookup; null = token unused. */
let txTokenRow: unknown = null;

function mockHappyPath(expiryDate: Date) {
  mockMemberFindFirst.mockResolvedValue({ id: MEMBER_ID });
  mockDbMembershipFindFirst.mockResolvedValue(null);
  // The transaction's membership.findFirst serves two lookups: the
  // token replay check (by renewalIdempotencyKey) and the current
  // membership load (by memberId). Dispatch on the query shape.
  mockTxMembershipFindFirst.mockImplementation(
    async (args: { where?: { renewalIdempotencyKey?: string } }) =>
      args?.where?.renewalIdempotencyKey
        ? txTokenRow
        : currentMembership(expiryDate),
  );
  mockMembershipCreate.mockResolvedValue({ id: NEW_MEMBERSHIP_ID });
  mockAuditCreate.mockResolvedValue({});
  mockTransaction.mockImplementation(async (cb: never) =>
    (cb as (tx: unknown) => Promise<unknown>)({
      organizationSubscription: { findUnique: mockTxSubscriptionFindUnique },
      $executeRaw: mockExecuteRaw,
      membership: {
        findFirst: mockTxMembershipFindFirst,
        create: mockMembershipCreate,
      },
      auditLog: { create: mockAuditCreate, findFirst: mockTxAuditFindFirst },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  txTokenRow = null;
  mockScope("OWNER");
  mockSubscriptionFindUnique.mockResolvedValue(ENTITLED);
  mockTxSubscriptionFindUnique.mockResolvedValue(ENTITLED);
  mockExecuteRaw.mockResolvedValue(1);
  mockTxAuditFindFirst.mockResolvedValue(null);
  mockDbAuditFindFirst.mockResolvedValue(null);
});

describe("getMemberPermissions — renewal flag", () => {
  it("allows OWNER, ADMIN and STAFF; denies TRAINER and MEMBER", () => {
    for (const role of ["OWNER", "ADMIN", "STAFF"] as const) {
      expect(getMemberPermissions(role).canRenewMembership).toBe(true);
    }
    expect(getMemberPermissions("TRAINER").canRenewMembership).toBe(false);
    expect(getMemberPermissions("MEMBER").canRenewMembership).toBe(false);
  });
});

describe("renewMembership — chaining", () => {
  it("renewing before expiry starts the new period the day after expiry, defaulting plan and fee", async () => {
    const expiry = utcDay(30);
    mockHappyPath(expiry);

    const result = await renewMembership(USER_ID, MEMBER_ID, {
      expiryDate: isoDay(utcDay(212)),
      idempotencyKey: TOKEN,
    });

    expect(result).toEqual({
      memberId: MEMBER_ID,
      membershipId: NEW_MEMBERSHIP_ID,
      previousMembershipId: CURRENT_MEMBERSHIP_ID,
    });
    const createArg = mockMembershipCreate.mock.calls[0]![0];
    expect(createArg.data.startDate).toEqual(utcDay(31));
    expect(createArg.data.expiryDate).toEqual(utcDay(212));
    expect(createArg.data.plan).toBe("SIX_MONTHS");
    expect(createArg.data.fee.toString()).toBe("6000");
    expect(createArg.data.renewalIdempotencyKey).toBe(TOKEN);
    expect(createArg.data.organizationId).toBe(ORG_ID);
    expect(createArg.data.memberId).toBe(MEMBER_ID);
    // Exactly one audit event, written in the same transaction.
    expect(mockAuditCreate).toHaveBeenCalledTimes(1);
    const auditArg = mockAuditCreate.mock.calls[0]![0];
    expect(auditArg.data.event).toBe("MEMBERSHIP_RENEWED");
    expect(auditArg.data.targetId).toBe(NEW_MEMBERSHIP_ID);
    expect(auditArg.data.metadata).toMatchObject({
      memberId: MEMBER_ID,
      previousMembershipId: CURRENT_MEMBERSHIP_ID,
      plan: "SIX_MONTHS",
      feePaise: 600000,
    });
  });

  it("renewing on the expiry date still chains to the following day", async () => {
    mockHappyPath(utcDay(0));
    await renewMembership(USER_ID, MEMBER_ID, {
      expiryDate: isoDay(utcDay(181)),
      idempotencyKey: TOKEN,
    });
    expect(mockMembershipCreate.mock.calls[0]![0].data.startDate).toEqual(
      utcDay(1),
    );
  });

  it("renewing after expiry starts the new period today", async () => {
    mockHappyPath(utcDay(-10));
    await renewMembership(USER_ID, MEMBER_ID, {
      expiryDate: isoDay(utcDay(90)),
      idempotencyKey: TOKEN,
    });
    expect(mockMembershipCreate.mock.calls[0]![0].data.startDate).toEqual(
      utcDay(0),
    );
  });

  it("honours staff-confirmed plan and fee overrides", async () => {
    mockHappyPath(utcDay(30));
    await renewMembership(USER_ID, MEMBER_ID, {
      plan: "TWELVE_MONTHS",
      fee: "10500.50",
      expiryDate: isoDay(utcDay(396)),
      idempotencyKey: TOKEN,
    });
    const createArg = mockMembershipCreate.mock.calls[0]![0];
    expect(createArg.data.plan).toBe("TWELVE_MONTHS");
    expect(createArg.data.fee.toString()).toBe("10500.5");
  });
});

describe("renewMembership — validation", () => {
  it("rejects an unknown plan without opening a transaction", async () => {
    mockHappyPath(utcDay(30));
    await expect(
      renewMembership(USER_ID, MEMBER_ID, {
        plan: "WEEKLY",
        expiryDate: isoDay(utcDay(212)),
        idempotencyKey: TOKEN,
      }),
    ).rejects.toBeInstanceOf(MemberValidationError);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects a malformed fee", async () => {
    mockHappyPath(utcDay(30));
    await expect(
      renewMembership(USER_ID, MEMBER_ID, {
        fee: "six thousand",
        expiryDate: isoDay(utcDay(212)),
        idempotencyKey: TOKEN,
      }),
    ).rejects.toBeInstanceOf(MemberValidationError);
    expect(mockMembershipCreate).not.toHaveBeenCalled();
  });

  it("rejects a malformed expiry date", async () => {
    mockHappyPath(utcDay(30));
    await expect(
      renewMembership(USER_ID, MEMBER_ID, {
        expiryDate: "31/12/2026",
        idempotencyKey: TOKEN,
      }),
    ).rejects.toBeInstanceOf(MemberValidationError);
  });

  it("rejects an expiry before the derived start date and writes nothing", async () => {
    mockHappyPath(utcDay(30));
    const error = await renewMembership(USER_ID, MEMBER_ID, {
      expiryDate: isoDay(utcDay(10)),
      idempotencyKey: TOKEN,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MemberValidationError);
    expect((error as MemberValidationError).errors.expiryDate).toContain(
      "start date",
    );
    expect(mockMembershipCreate).not.toHaveBeenCalled();
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  it("requires a well-formed idempotency token", async () => {
    mockHappyPath(utcDay(30));
    await expect(
      renewMembership(USER_ID, MEMBER_ID, {
        expiryDate: isoDay(utcDay(212)),
      }),
    ).rejects.toBeInstanceOf(MemberValidationError);
    await expect(
      renewMembership(USER_ID, MEMBER_ID, {
        expiryDate: isoDay(utcDay(212)),
        idempotencyKey: "not-a-token",
      }),
    ).rejects.toBeInstanceOf(MemberValidationError);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

describe("renewMembership — authorization and scope", () => {
  it("denies TRAINER", async () => {
    mockScope("TRAINER");
    mockHappyPath(utcDay(30));
    await expect(
      renewMembership(USER_ID, MEMBER_ID, {
        expiryDate: isoDay(utcDay(212)),
        idempotencyKey: TOKEN,
      }),
    ).rejects.toBeInstanceOf(MemberAuthorizationError);
    expect(mockMembershipCreate).not.toHaveBeenCalled();
  });

  it("allows STAFF", async () => {
    mockScope("STAFF");
    mockHappyPath(utcDay(30));
    const result = await renewMembership(USER_ID, MEMBER_ID, {
      expiryDate: isoDay(utcDay(212)),
      idempotencyKey: TOKEN,
    });
    expect(result.membershipId).toBe(NEW_MEMBERSHIP_ID);
  });

  it("returns the identical not-found for a foreign or nonexistent member", async () => {
    mockHappyPath(utcDay(30));
    mockMemberFindFirst.mockResolvedValue(null);
    await expect(
      renewMembership(USER_ID, MEMBER_ID, {
        expiryDate: isoDay(utcDay(212)),
        idempotencyKey: TOKEN,
      }),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("returns not-found when the member has no membership row", async () => {
    mockHappyPath(utcDay(30));
    mockTxMembershipFindFirst.mockResolvedValue(null);
    await expect(
      renewMembership(USER_ID, MEMBER_ID, {
        expiryDate: isoDay(utcDay(212)),
        idempotencyKey: TOKEN,
      }),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
    expect(mockMembershipCreate).not.toHaveBeenCalled();
  });

  it("is denied for a SaaS-restricted organization before any write", async () => {
    mockHappyPath(utcDay(30));
    mockSubscriptionFindUnique.mockResolvedValue({
      suspendedAt: new Date(),
      paidThroughAt: null,
      trialEndsAt: null,
    });
    await expect(
      renewMembership(USER_ID, MEMBER_ID, {
        expiryDate: isoDay(utcDay(212)),
        idempotencyKey: TOKEN,
      }),
    ).rejects.toBeInstanceOf(SubscriptionRestrictedError);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

describe("renewMembership — replay", () => {
  const EXISTING = {
    id: NEW_MEMBERSHIP_ID,
    memberId: MEMBER_ID,
    plan: "SIX_MONTHS" as const,
    fee: new Prisma.Decimal("6000.00"),
    expiryDate: utcDay(212),
  };

  it("an identical retry resolves to the original membership with no new writes", async () => {
    mockHappyPath(utcDay(30));
    mockDbMembershipFindFirst.mockResolvedValue(EXISTING);
    mockDbAuditFindFirst.mockResolvedValue({
      metadata: { previousMembershipId: CURRENT_MEMBERSHIP_ID },
    });

    const result = await renewMembership(USER_ID, MEMBER_ID, {
      expiryDate: isoDay(utcDay(212)),
      idempotencyKey: TOKEN,
    });

    expect(result).toEqual({
      memberId: MEMBER_ID,
      membershipId: NEW_MEMBERSHIP_ID,
      previousMembershipId: CURRENT_MEMBERSHIP_ID,
    });
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockMembershipCreate).not.toHaveBeenCalled();
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  it("reusing the token with a different expiry is a conflict", async () => {
    mockHappyPath(utcDay(30));
    mockDbMembershipFindFirst.mockResolvedValue(EXISTING);
    await expect(
      renewMembership(USER_ID, MEMBER_ID, {
        expiryDate: isoDay(utcDay(300)),
        idempotencyKey: TOKEN,
      }),
    ).rejects.toBeInstanceOf(MemberRenewalConflictError);
    expect(mockMembershipCreate).not.toHaveBeenCalled();
  });

  it("reusing the token for a different member is a conflict", async () => {
    mockHappyPath(utcDay(30));
    mockDbMembershipFindFirst.mockResolvedValue({
      ...EXISTING,
      memberId: "another-member",
    });
    await expect(
      renewMembership(USER_ID, MEMBER_ID, {
        expiryDate: isoDay(utcDay(212)),
        idempotencyKey: TOKEN,
      }),
    ).rejects.toBeInstanceOf(MemberRenewalConflictError);
  });

  it("a token committed by a racing request is resolved by the in-transaction recheck", async () => {
    mockHappyPath(utcDay(30));
    // Pre-transaction lookup misses; the row appears by the time the
    // transaction holds the locks.
    txTokenRow = EXISTING;
    mockTxAuditFindFirst.mockResolvedValue({
      metadata: { previousMembershipId: CURRENT_MEMBERSHIP_ID },
    });
    const result = await renewMembership(USER_ID, MEMBER_ID, {
      expiryDate: isoDay(utcDay(212)),
      idempotencyKey: TOKEN,
    });
    expect(result.membershipId).toBe(NEW_MEMBERSHIP_ID);
    expect(mockMembershipCreate).not.toHaveBeenCalled();
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });
});
