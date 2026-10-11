import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const {
  mockTransaction,
  mockTxQueryRaw,
  lockedActorRows,
  mockOrgMembershipFindFirst,
  mockOrgMembershipFindMany,
  mockOrgMembershipFindUnique,
  mockOrgMembershipCreate,
  mockOrgMembershipUpdateMany,
  mockOrgMembershipDeleteMany,
  mockUserFindUnique,
  mockAuditLogCreate,
  mockFindClerkUser,
} = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockTxQueryRaw: vi.fn(),
  lockedActorRows: new Map<
    string,
    { id: string; organizationId: string; role: string }
  >(),
  mockOrgMembershipFindFirst: vi.fn(),
  mockOrgMembershipFindMany: vi.fn(),
  mockOrgMembershipFindUnique: vi.fn(),
  mockOrgMembershipCreate: vi.fn(),
  mockOrgMembershipUpdateMany: vi.fn(),
  mockOrgMembershipDeleteMany: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockAuditLogCreate: vi.fn(),
  mockFindClerkUser: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({
  db: {
    organizationMembership: {
      findFirst: mockOrgMembershipFindFirst,
      findMany: mockOrgMembershipFindMany,
      findUnique: mockOrgMembershipFindUnique,
    },
    user: { findUnique: mockUserFindUnique },
    $transaction: mockTransaction,
  },
}));

vi.mock("@/lib/server/clerk-directory", () => {
  class ClerkDirectoryUnavailableError extends Error {
    constructor(message = "unavailable") {
      super(message);
      this.name = "ClerkDirectoryUnavailableError";
    }
  }
  return {
    findClerkUserByVerifiedEmail: mockFindClerkUser,
    ClerkDirectoryUnavailableError,
  };
});

import { ClerkDirectoryUnavailableError } from "@/lib/server/clerk-directory";
import {
  STAFF_SIGN_IN_FIRST_MESSAGE,
  StaffAccountNotFoundError,
  StaffAuthorizationError,
  StaffConflictError,
  StaffNotFoundError,
  StaffValidationError,
  addOrganizationStaff,
  canManageStaff,
  changeOrganizationStaffRole,
  findStaffCandidateByEmail,
  getStaffPermissions,
  listOrganizationStaff,
  normalizeEmail,
  revokeOrganizationStaffAccess,
} from "@/lib/server/staff";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const TARGET_USER_ID = "33333333-3333-4333-8333-333333333333";
const ORG_ID = "c3298d3b-a07f-33eb-de2b-00333455cf3f";
const MEMBERSHIP_ID = "d47a1c5b-8e3f-4a2b-9c1d-001122334455";
const CLERK_ID = "user_2abcDEF";

function mockScope(userId: string, role: string) {
  mockOrgMembershipFindFirst.mockResolvedValue({
    userId,
    organizationId: ORG_ID,
    role,
  });
  // The in-transaction revalidation locks and re-reads the actor's row;
  // by default it sees the same role the pre-transaction scope resolved.
  lockedActorRows.set(userId, {
    id: "actor-membership-id",
    organizationId: ORG_ID,
    role,
  });
}

function mockTx() {
  mockTransaction.mockImplementation(async (cb: never) =>
    (cb as (tx: unknown) => Promise<unknown>)({
      organizationMembership: {
        create: mockOrgMembershipCreate,
        findFirst: mockOrgMembershipFindFirst,
        updateMany: mockOrgMembershipUpdateMany,
        deleteMany: mockOrgMembershipDeleteMany,
      },
      auditLog: { create: mockAuditLogCreate },
      $queryRaw: mockTxQueryRaw,
    }),
  );
}

function mockCandidateFound() {
  mockFindClerkUser.mockResolvedValue({
    clerkUserId: CLERK_ID,
    displayName: "Target Person",
  });
  mockUserFindUnique.mockResolvedValue({ id: TARGET_USER_ID });
}

function targetMembership(role: string, userId = TARGET_USER_ID) {
  return {
    id: MEMBERSHIP_ID,
    userId,
    organizationId: ORG_ID,
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  lockedActorRows.clear();
  mockTx();
  mockAuditLogCreate.mockResolvedValue({ id: "audit-id" });
  // SELECT ... FOR UPDATE of the actor's primary membership row: the
  // tagged-template call passes (strings, userId). Tests override the
  // locked row via lockedActorRows to simulate mid-flight changes.
  mockTxQueryRaw.mockImplementation(async (...args: unknown[]) => {
    const userId = args[1] as string;
    const row = lockedActorRows.get(userId);
    return row ? [row] : [];
  });
});

describe("permission helpers", () => {
  it("grants OWNER the full matrix except OWNER itself", () => {
    const perms = getStaffPermissions("OWNER");
    expect(perms.canViewStaff).toBe(true);
    expect(perms.canManageStaff).toBe(true);
    expect(perms.grantableRoles).toEqual(["ADMIN", "STAFF", "TRAINER"]);
    expect(perms.manageableRoles).toEqual(["ADMIN", "STAFF", "TRAINER"]);
    expect(perms.grantableRoles).not.toContain("OWNER");
    expect(perms.manageableRoles).not.toContain("OWNER");
  });

  it("limits ADMIN to STAFF/TRAINER grants and targets", () => {
    const perms = getStaffPermissions("ADMIN");
    expect(perms.canViewStaff).toBe(true);
    expect(perms.grantableRoles).toEqual(["STAFF", "TRAINER"]);
    expect(perms.manageableRoles).toEqual(["STAFF", "TRAINER"]);
  });

  it.each(["STAFF", "TRAINER", "MEMBER"] as const)(
    "gives %s no staff permissions",
    (role) => {
      const perms = getStaffPermissions(role);
      expect(perms.canViewStaff).toBe(false);
      expect(perms.canManageStaff).toBe(false);
      expect(perms.grantableRoles).toEqual([]);
      expect(canManageStaff(role)).toBe(false);
    },
  );

  it("normalizes email by trimming and lowercasing", () => {
    expect(normalizeEmail("  Alice@Example.COM ")).toBe("alice@example.com");
  });
});

describe("listOrganizationStaff", () => {
  it("lists the actor's gym staff memberships for OWNER and ADMIN", async () => {
    mockScope(OWNER_ID, "OWNER");
    mockOrgMembershipFindMany.mockResolvedValue([
      {
        id: MEMBERSHIP_ID,
        userId: TARGET_USER_ID,
        role: "STAFF",
        createdAt: new Date(0),
      },
    ]);
    const rows = await listOrganizationStaff(OWNER_ID);
    expect(rows).toEqual([
      {
        id: MEMBERSHIP_ID,
        userId: TARGET_USER_ID,
        role: "STAFF",
        createdAt: new Date(0),
      },
    ]);
    expect(mockOrgMembershipFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: ORG_ID,
          role: { in: ["OWNER", "ADMIN", "STAFF", "TRAINER"] },
        },
      }),
    );
  });

  it("restricts the query to staff roles, so MEMBER memberships are excluded", async () => {
    mockScope(OWNER_ID, "OWNER");
    mockOrgMembershipFindMany.mockResolvedValue([]);
    await listOrganizationStaff(OWNER_ID);
    const call = mockOrgMembershipFindMany.mock.calls[0]?.[0] as {
      where: { organizationId: string; role: { in: string[] } };
    };
    expect(call.where.organizationId).toBe(ORG_ID);
    expect(call.where.role.in).toEqual(["OWNER", "ADMIN", "STAFF", "TRAINER"]);
    expect(call.where.role.in).not.toContain("MEMBER");
  });

  it("follows the actor's primary membership when scoping the list", async () => {
    // The actor belongs to two gyms; getPrimaryMembership resolves the
    // earliest one (ORG_ID here) and the list must be scoped to exactly
    // that organization — never to a client-named or secondary gym.
    mockScope(ADMIN_ID, "ADMIN");
    mockOrgMembershipFindMany.mockResolvedValue([]);
    await listOrganizationStaff(ADMIN_ID);
    expect(mockOrgMembershipFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG_ID }),
      }),
    );
  });

  it.each(["STAFF", "TRAINER", "MEMBER"] as const)(
    "denies %s",
    async (role) => {
      mockScope(TARGET_USER_ID, role);
      await expect(listOrganizationStaff(TARGET_USER_ID)).rejects.toBeInstanceOf(
        StaffAuthorizationError,
      );
      expect(mockOrgMembershipFindMany).not.toHaveBeenCalled();
    },
  );

  it("denies unauthenticated and membership-less callers", async () => {
    await expect(listOrganizationStaff("")).rejects.toBeInstanceOf(
      StaffAuthorizationError,
    );
    mockOrgMembershipFindFirst.mockResolvedValue(null);
    await expect(listOrganizationStaff(OWNER_ID)).rejects.toBeInstanceOf(
      StaffAuthorizationError,
    );
  });
});

describe("findStaffCandidateByEmail", () => {
  beforeEach(() => {
    mockScope(OWNER_ID, "OWNER");
    mockCandidateFound();
    mockOrgMembershipFindUnique.mockResolvedValue(null);
  });

  it("resolves a verified account to exactly the public candidate fields", async () => {
    const result = await findStaffCandidateByEmail(
      OWNER_ID,
      "  Target@Example.com ",
    );
    expect(mockFindClerkUser).toHaveBeenCalledWith("target@example.com");
    expect(result).toEqual({
      email: "target@example.com",
      displayName: "Target Person",
      existingRole: null,
    });
    // The internal identifiers must not leak into the public result:
    // the add operation re-resolves the account server-side by email.
    expect(result).not.toHaveProperty("userId");
    expect(result).not.toHaveProperty("clerkUserId");
    expect(Object.keys(result).sort()).toEqual([
      "displayName",
      "email",
      "existingRole",
    ]);
  });

  it("reports the candidate's existing role in this gym", async () => {
    mockOrgMembershipFindUnique.mockResolvedValue({ role: "TRAINER" });
    const result = await findStaffCandidateByEmail(
      OWNER_ID,
      "target@example.com",
    );
    expect(result.existingRole).toBe("TRAINER");
  });

  it("rejects malformed emails before any lookup", async () => {
    await expect(
      findStaffCandidateByEmail(OWNER_ID, "not-an-email"),
    ).rejects.toBeInstanceOf(StaffValidationError);
    expect(mockFindClerkUser).not.toHaveBeenCalled();
  });

  it("fails with the sign-in-first message when Clerk has no match", async () => {
    mockFindClerkUser.mockResolvedValue(null);
    await expect(
      findStaffCandidateByEmail(OWNER_ID, "ghost@example.com"),
    ).rejects.toMatchObject({
      name: "StaffAccountNotFoundError",
      message: STAFF_SIGN_IN_FIRST_MESSAGE,
    });
  });

  it("fails identically when the local User record is missing", async () => {
    mockUserFindUnique.mockResolvedValue(null);
    await expect(
      findStaffCandidateByEmail(OWNER_ID, "target@example.com"),
    ).rejects.toBeInstanceOf(StaffAccountNotFoundError);
  });

  it("propagates Clerk provider failure as retryable, not as not-found", async () => {
    mockFindClerkUser.mockRejectedValue(new ClerkDirectoryUnavailableError());
    await expect(
      findStaffCandidateByEmail(OWNER_ID, "target@example.com"),
    ).rejects.toBeInstanceOf(ClerkDirectoryUnavailableError);
  });

  it("denies non-managers before any lookup happens", async () => {
    mockScope(TARGET_USER_ID, "STAFF");
    await expect(
      findStaffCandidateByEmail(TARGET_USER_ID, "target@example.com"),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);
    expect(mockFindClerkUser).not.toHaveBeenCalled();
  });
});

describe("addOrganizationStaff", () => {
  beforeEach(() => {
    mockCandidateFound();
    mockOrgMembershipCreate.mockResolvedValue({
      id: MEMBERSHIP_ID,
      userId: TARGET_USER_ID,
      organizationId: ORG_ID,
      role: "STAFF",
    });
  });

  it("OWNER adds an ADMIN and audits STAFF_ADDED in the same transaction", async () => {
    mockScope(OWNER_ID, "OWNER");
    const created = await addOrganizationStaff(OWNER_ID, {
      email: "target@example.com",
      role: "ADMIN",
    });
    expect(created.id).toBe(MEMBERSHIP_ID);
    expect(mockOrgMembershipCreate).toHaveBeenCalledWith({
      data: {
        userId: TARGET_USER_ID,
        organizationId: ORG_ID,
        role: "ADMIN",
      },
    });
    expect(mockAuditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORG_ID,
        actorUserId: OWNER_ID,
        event: "STAFF_ADDED",
        targetType: "OrganizationMembership",
        targetId: MEMBERSHIP_ID,
        metadata: { targetUserId: TARGET_USER_ID, role: "ADMIN" },
      }),
    });
  });

  it("ADMIN adds STAFF but cannot grant ADMIN", async () => {
    mockScope(ADMIN_ID, "ADMIN");
    await addOrganizationStaff(ADMIN_ID, {
      email: "target@example.com",
      role: "STAFF",
    });
    expect(mockOrgMembershipCreate).toHaveBeenCalledTimes(1);
    await expect(
      addOrganizationStaff(ADMIN_ID, {
        email: "target@example.com",
        role: "ADMIN",
      }),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);
  });

  it("never assigns OWNER or MEMBER, whoever asks", async () => {
    mockScope(OWNER_ID, "OWNER");
    await expect(
      addOrganizationStaff(OWNER_ID, {
        email: "target@example.com",
        role: "OWNER",
      }),
    ).rejects.toBeInstanceOf(StaffValidationError);
    await expect(
      addOrganizationStaff(OWNER_ID, {
        email: "target@example.com",
        role: "MEMBER",
      }),
    ).rejects.toBeInstanceOf(StaffValidationError);
    expect(mockOrgMembershipCreate).not.toHaveBeenCalled();
  });

  it.each(["STAFF", "TRAINER", "MEMBER"] as const)(
    "denies %s actors",
    async (role) => {
      mockScope(TARGET_USER_ID, role);
      await expect(
        addOrganizationStaff(TARGET_USER_ID, {
          email: "target@example.com",
          role: "STAFF",
        }),
      ).rejects.toBeInstanceOf(StaffAuthorizationError);
      expect(mockFindClerkUser).not.toHaveBeenCalled();
    },
  );

  it("rejects adding yourself", async () => {
    mockScope(OWNER_ID, "OWNER");
    mockUserFindUnique.mockResolvedValue({ id: OWNER_ID });
    await expect(
      addOrganizationStaff(OWNER_ID, {
        email: "target@example.com",
        role: "STAFF",
      }),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);
    expect(mockOrgMembershipCreate).not.toHaveBeenCalled();
  });

  it("translates a duplicate (raced P2002) into a conflict, with no audit", async () => {
    mockScope(OWNER_ID, "OWNER");
    mockOrgMembershipCreate.mockRejectedValue(uniqueViolation());
    await expect(
      addOrganizationStaff(OWNER_ID, {
        email: "target@example.com",
        role: "STAFF",
      }),
    ).rejects.toBeInstanceOf(StaffConflictError);
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });

  it("fails safely for unregistered accounts, writing nothing", async () => {
    mockScope(OWNER_ID, "OWNER");
    mockFindClerkUser.mockResolvedValue(null);
    await expect(
      addOrganizationStaff(OWNER_ID, {
        email: "ghost@example.com",
        role: "STAFF",
      }),
    ).rejects.toBeInstanceOf(StaffAccountNotFoundError);
    expect(mockOrgMembershipCreate).not.toHaveBeenCalled();
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });
});

describe("changeOrganizationStaffRole", () => {
  beforeEach(() => {
    mockOrgMembershipUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("OWNER changes STAFF to TRAINER and audits from/to", async () => {
    mockScope(OWNER_ID, "OWNER");
    mockOrgMembershipFindFirst
      .mockResolvedValueOnce({
        userId: OWNER_ID,
        organizationId: ORG_ID,
        role: "OWNER",
      })
      .mockResolvedValueOnce(targetMembership("STAFF"));
    const result = await changeOrganizationStaffRole(OWNER_ID, {
      membershipId: MEMBERSHIP_ID,
      role: "TRAINER",
    });
    expect(result.role).toBe("TRAINER");
    expect(mockOrgMembershipUpdateMany).toHaveBeenCalledWith({
      where: { id: MEMBERSHIP_ID, organizationId: ORG_ID, role: "STAFF" },
      data: { role: "TRAINER" },
    });
    expect(mockAuditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event: "STAFF_ROLE_CHANGED",
        targetId: MEMBERSHIP_ID,
        metadata: {
          targetUserId: TARGET_USER_ID,
          fromRole: "STAFF",
          toRole: "TRAINER",
        },
      }),
    });
  });

  it("ADMIN cannot alter another ADMIN, but OWNER can", async () => {
    mockScope(ADMIN_ID, "ADMIN");
    mockOrgMembershipFindFirst
      .mockResolvedValueOnce({
        userId: ADMIN_ID,
        organizationId: ORG_ID,
        role: "ADMIN",
      })
      .mockResolvedValueOnce(targetMembership("ADMIN"));
    await expect(
      changeOrganizationStaffRole(ADMIN_ID, {
        membershipId: MEMBERSHIP_ID,
        role: "STAFF",
      }),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);
    expect(mockOrgMembershipUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects OWNER targets, self-changes, and foreign memberships", async () => {
    mockScope(OWNER_ID, "OWNER");
    const scopeRow = {
      userId: OWNER_ID,
      organizationId: ORG_ID,
      role: "OWNER",
    };
    mockOrgMembershipFindFirst
      .mockResolvedValueOnce(scopeRow)
      .mockResolvedValueOnce(targetMembership("OWNER", ADMIN_ID));
    await expect(
      changeOrganizationStaffRole(OWNER_ID, {
        membershipId: MEMBERSHIP_ID,
        role: "STAFF",
      }),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);

    mockOrgMembershipFindFirst
      .mockResolvedValueOnce(scopeRow)
      .mockResolvedValueOnce(targetMembership("ADMIN", OWNER_ID));
    await expect(
      changeOrganizationStaffRole(OWNER_ID, {
        membershipId: MEMBERSHIP_ID,
        role: "STAFF",
      }),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);

    mockOrgMembershipFindFirst
      .mockResolvedValueOnce(scopeRow)
      .mockResolvedValueOnce(null);
    await expect(
      changeOrganizationStaffRole(OWNER_ID, {
        membershipId: MEMBERSHIP_ID,
        role: "STAFF",
      }),
    ).rejects.toBeInstanceOf(StaffNotFoundError);
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });

  it("treats re-requesting the current role as a no-op (no write, no audit)", async () => {
    mockScope(OWNER_ID, "OWNER");
    mockOrgMembershipFindFirst
      .mockResolvedValueOnce({
        userId: OWNER_ID,
        organizationId: ORG_ID,
        role: "OWNER",
      })
      .mockResolvedValueOnce(targetMembership("STAFF"));
    const result = await changeOrganizationStaffRole(OWNER_ID, {
      membershipId: MEMBERSHIP_ID,
      role: "STAFF",
    });
    expect(result.role).toBe("STAFF");
    expect(mockOrgMembershipUpdateMany).not.toHaveBeenCalled();
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });

  it("surfaces a concurrent modification as a conflict, with no audit", async () => {
    mockScope(OWNER_ID, "OWNER");
    mockOrgMembershipFindFirst
      .mockResolvedValueOnce({
        userId: OWNER_ID,
        organizationId: ORG_ID,
        role: "OWNER",
      })
      .mockResolvedValueOnce(targetMembership("STAFF"));
    mockOrgMembershipUpdateMany.mockResolvedValue({ count: 0 });
    await expect(
      changeOrganizationStaffRole(OWNER_ID, {
        membershipId: MEMBERSHIP_ID,
        role: "TRAINER",
      }),
    ).rejects.toBeInstanceOf(StaffConflictError);
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });
});

describe("revokeOrganizationStaffAccess", () => {
  beforeEach(() => {
    mockOrgMembershipDeleteMany.mockResolvedValue({ count: 1 });
  });

  function scopeThenTarget(actorId: string, actorRole: string, target: unknown) {
    mockOrgMembershipFindFirst
      .mockResolvedValueOnce({
        userId: actorId,
        organizationId: ORG_ID,
        role: actorRole,
      })
      .mockResolvedValueOnce(target);
    lockedActorRows.set(actorId, {
      id: "actor-membership-id",
      organizationId: ORG_ID,
      role: actorRole,
    });
  }

  it("OWNER revokes STAFF and audits the removed role", async () => {
    scopeThenTarget(OWNER_ID, "OWNER", targetMembership("STAFF"));
    await revokeOrganizationStaffAccess(OWNER_ID, {
      membershipId: MEMBERSHIP_ID,
    });
    expect(mockOrgMembershipDeleteMany).toHaveBeenCalledWith({
      where: { id: MEMBERSHIP_ID, organizationId: ORG_ID, role: "STAFF" },
    });
    expect(mockAuditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event: "STAFF_ACCESS_REVOKED",
        metadata: { targetUserId: TARGET_USER_ID, role: "STAFF" },
      }),
    });
  });

  it("ADMIN revokes TRAINER but cannot revoke another ADMIN", async () => {
    scopeThenTarget(ADMIN_ID, "ADMIN", targetMembership("TRAINER"));
    await revokeOrganizationStaffAccess(ADMIN_ID, {
      membershipId: MEMBERSHIP_ID,
    });
    expect(mockOrgMembershipDeleteMany).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mockTx();
    mockOrgMembershipDeleteMany.mockResolvedValue({ count: 1 });
    scopeThenTarget(ADMIN_ID, "ADMIN", targetMembership("ADMIN"));
    await expect(
      revokeOrganizationStaffAccess(ADMIN_ID, {
        membershipId: MEMBERSHIP_ID,
      }),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);
    expect(mockOrgMembershipDeleteMany).not.toHaveBeenCalled();
  });

  it("rejects self-removal, OWNER targets, and foreign memberships", async () => {
    scopeThenTarget(OWNER_ID, "OWNER", targetMembership("ADMIN", OWNER_ID));
    await expect(
      revokeOrganizationStaffAccess(OWNER_ID, {
        membershipId: MEMBERSHIP_ID,
      }),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);

    scopeThenTarget(OWNER_ID, "OWNER", targetMembership("OWNER", ADMIN_ID));
    await expect(
      revokeOrganizationStaffAccess(OWNER_ID, {
        membershipId: MEMBERSHIP_ID,
      }),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);

    scopeThenTarget(OWNER_ID, "OWNER", null);
    await expect(
      revokeOrganizationStaffAccess(OWNER_ID, {
        membershipId: MEMBERSHIP_ID,
      }),
    ).rejects.toBeInstanceOf(StaffNotFoundError);
    expect(mockOrgMembershipDeleteMany).not.toHaveBeenCalled();
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });
});

describe("actor revalidation at the mutation boundary", () => {
  it("add: denies when the actor's membership was revoked mid-flight (during the Clerk lookup)", async () => {
    mockScope(OWNER_ID, "OWNER");
    mockCandidateFound();
    // The pre-transaction scope said OWNER, but by the time the mutation
    // transaction locks the actor's row, the row is gone.
    lockedActorRows.delete(OWNER_ID);
    await expect(
      addOrganizationStaff(OWNER_ID, {
        email: "target@example.com",
        role: "STAFF",
      }),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);
    expect(mockOrgMembershipCreate).not.toHaveBeenCalled();
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });

  it("add: re-derives grant rights from the fresh role (OWNER downgraded to ADMIN cannot grant ADMIN)", async () => {
    mockScope(OWNER_ID, "OWNER");
    mockCandidateFound();
    lockedActorRows.set(OWNER_ID, {
      id: "actor-membership-id",
      organizationId: ORG_ID,
      role: "ADMIN",
    });
    await expect(
      addOrganizationStaff(OWNER_ID, {
        email: "target@example.com",
        role: "ADMIN",
      }),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);
    expect(mockOrgMembershipCreate).not.toHaveBeenCalled();
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });

  it("change: denies when the actor was downgraded to STAFF mid-flight", async () => {
    mockScope(ADMIN_ID, "ADMIN");
    lockedActorRows.set(ADMIN_ID, {
      id: "actor-membership-id",
      organizationId: ORG_ID,
      role: "STAFF",
    });
    mockOrgMembershipFindFirst
      .mockResolvedValueOnce({
        userId: ADMIN_ID,
        organizationId: ORG_ID,
        role: "ADMIN",
      })
      .mockResolvedValueOnce(targetMembership("STAFF"));
    await expect(
      changeOrganizationStaffRole(ADMIN_ID, {
        membershipId: MEMBERSHIP_ID,
        role: "TRAINER",
      }),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);
    expect(mockOrgMembershipUpdateMany).not.toHaveBeenCalled();
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });

  it("revoke: denies when the actor's primary membership moved to another gym", async () => {
    mockScope(OWNER_ID, "OWNER");
    lockedActorRows.set(OWNER_ID, {
      id: "actor-membership-id",
      organizationId: "another-org-id",
      role: "OWNER",
    });
    mockOrgMembershipFindFirst
      .mockResolvedValueOnce({
        userId: OWNER_ID,
        organizationId: ORG_ID,
        role: "OWNER",
      })
      .mockResolvedValueOnce(targetMembership("STAFF"));
    mockOrgMembershipDeleteMany.mockResolvedValue({ count: 1 });
    await expect(
      revokeOrganizationStaffAccess(OWNER_ID, {
        membershipId: MEMBERSHIP_ID,
      }),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);
    expect(mockOrgMembershipDeleteMany).not.toHaveBeenCalled();
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });
});
