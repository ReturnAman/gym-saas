import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const {
  mockTransaction,
  mockOrgMembershipFindFirst,
  mockOrgMembershipFindMany,
  mockMemberFindFirst,
  mockMembershipFindFirst,
  mockSessionFindFirst,
  mockSessionFindMany,
  mockTxSessionFindMany,
  mockSessionCreate,
  mockSessionUpdate,
  mockSessionUpdateMany,
  mockAuditLogCreate,
} = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockOrgMembershipFindFirst: vi.fn(),
  mockOrgMembershipFindMany: vi.fn(),
  mockMemberFindFirst: vi.fn(),
  mockMembershipFindFirst: vi.fn(),
  mockSessionFindFirst: vi.fn(),
  mockSessionFindMany: vi.fn(),
  mockTxSessionFindMany: vi.fn(),
  mockSessionCreate: vi.fn(),
  mockSessionUpdate: vi.fn(),
  mockSessionUpdateMany: vi.fn(),
  mockAuditLogCreate: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({
  db: {
    organizationMembership: {
      findFirst: mockOrgMembershipFindFirst,
      findMany: mockOrgMembershipFindMany,
    },
    member: { findFirst: mockMemberFindFirst },
    membership: { findFirst: mockMembershipFindFirst },
    attendanceSession: {
      findFirst: mockSessionFindFirst,
      findMany: mockSessionFindMany,
    },
    $transaction: mockTransaction,
  },
}));

// The real getPrimaryMembership runs against the mocked db above; only the
// Clerk-touching auth module is stubbed out.
vi.mock("@/lib/server/auth", () => ({
  getCurrentUser: vi.fn(),
}));

import { getKolkataDayBoundsUtc } from "@/lib/attendance";
import {
  AttendanceAlreadyCheckedInError,
  AttendanceAuthorizationError,
  AttendanceConfirmationRequiredError,
  AttendanceNoMembershipError,
  AttendanceNotFoundError,
  canCheckInAttendance,
  canManageAttendance,
  canViewAttendance,
  checkInMember,
  checkOutAllOpenSessions,
  checkOutMember,
  getAttendancePermissions,
  getOpenSession,
  listMemberAttendance,
  listTodayAttendance,
} from "@/lib/server/attendance";

const USER_ID = "b2198c2a-f96e-22da-cd1a-00222444be2e";
const ORG_ID = "c3298d3b-a07f-33eb-de2b-00333455cf3f";
const MEMBER_ID = "f65a9b4e-d21c-44de-bc3d-00666788ef4f";
const MEMBERSHIP_ID = "d47a1c5b-8e3f-4a2b-9c1d-001122334455";
const SESSION_ID = "a12b3c4d-5e6f-47a8-b9c0-0a1b2c3d4e5f";

// Fixed "now" for every test: 2026-10-10 05:00 UTC (10:30 IST).
const NOW = new Date("2026-10-10T05:00:00.000Z");
const CHECK_IN = new Date("2026-10-10T01:00:00.000Z");

function mockRoleScope(role: string) {
  mockOrgMembershipFindFirst.mockResolvedValue({
    userId: USER_ID,
    organizationId: ORG_ID,
    role,
  });
}

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/** Member present, no open session, membership with the given expiry. */
function mockCheckInScenario(expiryDate: Date | null) {
  mockMemberFindFirst.mockResolvedValue({ id: MEMBER_ID });
  mockSessionFindFirst.mockResolvedValue(null);
  mockMembershipFindFirst.mockResolvedValue(
    expiryDate ? { id: MEMBERSHIP_ID, expiryDate } : null,
  );
  mockSessionCreate.mockResolvedValue({ id: SESSION_ID });
  mockAuditLogCreate.mockResolvedValue({ id: "audit-id" });
}

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "7.10.0",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRoleScope("OWNER");
  mockOrgMembershipFindMany.mockResolvedValue([]);
  mockTransaction.mockImplementation(async (cb: never) =>
    (cb as (tx: unknown) => Promise<unknown>)({
      attendanceSession: {
        create: mockSessionCreate,
        update: mockSessionUpdate,
        updateMany: mockSessionUpdateMany,
        findMany: mockTxSessionFindMany,
      },
      auditLog: { create: mockAuditLogCreate },
    }),
  );
});

describe("attendance permissions", () => {
  it("allows OWNER, ADMIN and STAFF to manage attendance", () => {
    for (const role of ["OWNER", "ADMIN", "STAFF"] as const) {
      expect(canManageAttendance(role)).toBe(true);
      expect(canCheckInAttendance(role)).toBe(true);
      expect(getAttendancePermissions(role)).toEqual({
        canView: true,
        canManage: true,
        canCheckIn: true,
      });
    }
  });

  it("allows TRAINER to view and check in, but not manage", () => {
    expect(canViewAttendance("TRAINER")).toBe(true);
    expect(canManageAttendance("TRAINER")).toBe(false);
    expect(canCheckInAttendance("TRAINER")).toBe(true);
    expect(getAttendancePermissions("TRAINER")).toEqual({
      canView: true,
      canManage: false,
      canCheckIn: true,
    });
  });

  it("allows MEMBER neither to view nor manage", () => {
    expect(canViewAttendance("MEMBER")).toBe(false);
    expect(canManageAttendance("MEMBER")).toBe(false);
    expect(canCheckInAttendance("MEMBER")).toBe(false);
  });
});

describe("checkInMember", () => {
  it.each(["OWNER", "ADMIN", "STAFF"])(
    "checks in for role %s with its audit event in one transaction",
    async (role) => {
      mockRoleScope(role);
      mockCheckInScenario(utcDate(2027, 1, 1)); // ACTIVE

      const { sessionId } = await checkInMember(USER_ID, MEMBER_ID, {
        now: NOW,
      });
      expect(sessionId).toBe(SESSION_ID);

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockSessionCreate).toHaveBeenCalledTimes(1);
      expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);

      const data = mockSessionCreate.mock.calls[0]?.[0].data;
      expect(data).toEqual({
        organizationId: ORG_ID,
        memberId: MEMBER_ID,
        checkedInBy: USER_ID,
        source: "MANUAL",
        checkInAt: NOW,
      });

      const auditData = mockAuditLogCreate.mock.calls[0]?.[0].data;
      expect(auditData).toMatchObject({
        organizationId: ORG_ID,
        actorUserId: USER_ID,
        event: "ATTENDANCE_MANUALLY_ADDED",
        targetType: "AttendanceSession",
        targetId: SESSION_ID,
      });
      expect(auditData.metadata).toEqual({
        memberId: MEMBER_ID,
        membershipId: MEMBERSHIP_ID,
        membershipStatus: "ACTIVE",
        expiredConfirmation: false,
      });
    },
  );

  // TRAINER is intentionally absent here: since the Slice 2 QR
  // revision a trainer MAY check a member in (see
  // attendance-trainer.test.ts). MEMBER remains refused.
  it.each(["MEMBER"])(
    "refuses role %s without touching the database",
    async (role) => {
      mockRoleScope(role);
      await expect(
        checkInMember(USER_ID, MEMBER_ID, { now: NOW }),
      ).rejects.toBeInstanceOf(AttendanceAuthorizationError);
      expect(mockMemberFindFirst).not.toHaveBeenCalled();
      expect(mockTransaction).not.toHaveBeenCalled();
    },
  );

  it("requires authentication and organization membership", async () => {
    await expect(checkInMember("", MEMBER_ID)).rejects.toThrow(
      /authentication/i,
    );
    mockOrgMembershipFindFirst.mockResolvedValue(null);
    await expect(checkInMember(USER_ID, MEMBER_ID)).rejects.toThrow(
      /organization/i,
    );
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("treats a member from another organization as not found", async () => {
    mockMemberFindFirst.mockResolvedValue(null);
    await expect(
      checkInMember(USER_ID, "other-org-member-id", { now: NOW }),
    ).rejects.toBeInstanceOf(AttendanceNotFoundError);
    expect(mockMemberFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "other-org-member-id", organizationId: ORG_ID },
      }),
    );
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("refuses a second check-in while a session is open (pre-check)", async () => {
    mockMemberFindFirst.mockResolvedValue({ id: MEMBER_ID });
    mockSessionFindFirst.mockResolvedValue({ id: SESSION_ID });
    await expect(
      checkInMember(USER_ID, MEMBER_ID, { now: NOW }),
    ).rejects.toBeInstanceOf(AttendanceAlreadyCheckedInError);
    expect(mockSessionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_ID, memberId: MEMBER_ID, checkOutAt: null },
      }),
    );
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("translates a raced P2002 from the partial unique index to already-checked-in", async () => {
    mockCheckInScenario(utcDate(2027, 1, 1));
    mockSessionCreate.mockRejectedValue(uniqueViolation());
    await expect(
      checkInMember(USER_ID, MEMBER_ID, { now: NOW }),
    ).rejects.toBeInstanceOf(AttendanceAlreadyCheckedInError);
  });

  it("holds an EXPIRED membership for explicit confirmation and writes nothing", async () => {
    mockCheckInScenario(utcDate(2026, 10, 5)); // expired 5 days before NOW
    const error = await checkInMember(USER_ID, MEMBER_ID, { now: NOW }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AttendanceConfirmationRequiredError);
    expect(
      (error as AttendanceConfirmationRequiredError).membershipExpiredOn,
    ).toBe("2026-10-05");
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("checks in an EXPIRED membership with confirmation and audits the confirmation", async () => {
    mockCheckInScenario(utcDate(2026, 10, 5));
    const { sessionId } = await checkInMember(USER_ID, MEMBER_ID, {
      now: NOW,
      confirmExpiredMembership: true,
    });
    expect(sessionId).toBe(SESSION_ID);
    const auditData = mockAuditLogCreate.mock.calls[0]?.[0].data;
    expect(auditData.metadata).toEqual({
      memberId: MEMBER_ID,
      membershipId: MEMBERSHIP_ID,
      membershipStatus: "EXPIRED",
      expiredConfirmation: true,
    });
  });

  it("checks in an EXPIRING membership without confirmation", async () => {
    mockCheckInScenario(utcDate(2026, 10, 13)); // 3 days after NOW
    const { sessionId } = await checkInMember(USER_ID, MEMBER_ID, { now: NOW });
    expect(sessionId).toBe(SESSION_ID);
    const auditData = mockAuditLogCreate.mock.calls[0]?.[0].data;
    expect(auditData.metadata).toMatchObject({
      membershipStatus: "EXPIRING",
      expiredConfirmation: false,
    });
  });

  it("blocks a member with no membership, even with confirmation", async () => {
    mockCheckInScenario(null);
    await expect(
      checkInMember(USER_ID, MEMBER_ID, {
        now: NOW,
        confirmExpiredMembership: true,
      }),
    ).rejects.toBeInstanceOf(AttendanceNoMembershipError);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("checks membership status against the member's latest membership, tenant-scoped", async () => {
    mockCheckInScenario(utcDate(2027, 1, 1));
    await checkInMember(USER_ID, MEMBER_ID, { now: NOW });
    expect(mockMembershipFindFirst).toHaveBeenCalledWith({
      where: { memberId: MEMBER_ID, organizationId: ORG_ID },
      orderBy: { createdAt: "desc" },
      select: { id: true, expiryDate: true },
    });
  });
});

describe("checkOutMember", () => {
  function openSessionRow() {
    return {
      id: SESSION_ID,
      organizationId: ORG_ID,
      memberId: MEMBER_ID,
      checkedInBy: USER_ID,
      source: "MANUAL" as const,
      checkInAt: CHECK_IN,
      checkOutAt: null,
      createdAt: CHECK_IN,
      updatedAt: CHECK_IN,
    };
  }

  it("closes an open session and audits the check-out in one transaction", async () => {
    mockSessionFindFirst.mockResolvedValue(openSessionRow());
    mockSessionUpdateMany.mockResolvedValue({ count: 1 });
    mockAuditLogCreate.mockResolvedValue({ id: "audit-id" });
    mockOrgMembershipFindMany.mockResolvedValue([
      { userId: USER_ID, role: "OWNER" },
    ]);

    const item = await checkOutMember(USER_ID, SESSION_ID, { now: NOW });
    expect(item.id).toBe(SESSION_ID);
    expect(item.checkOutAt).toBe(NOW.toISOString());
    expect(item.checkedInByRole).toBe("OWNER");

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    // The close is claimed conditionally: only a still-open session in the
    // caller's organization transitions.
    expect(mockSessionUpdateMany).toHaveBeenCalledWith({
      where: { id: SESSION_ID, organizationId: ORG_ID, checkOutAt: null },
      data: { checkOutAt: NOW },
    });
    const auditData = mockAuditLogCreate.mock.calls[0]?.[0].data;
    expect(auditData).toMatchObject({
      organizationId: ORG_ID,
      actorUserId: USER_ID,
      event: "ATTENDANCE_CHECKED_OUT",
      targetType: "AttendanceSession",
      targetId: SESSION_ID,
    });
    expect(auditData.metadata).toEqual({ memberId: MEMBER_ID });
  });

  it("is idempotent: an already-closed session is returned with NO second audit", async () => {
    mockSessionFindFirst.mockResolvedValue({
      ...openSessionRow(),
      checkOutAt: CHECK_IN,
    });
    const item = await checkOutMember(USER_ID, SESSION_ID, { now: NOW });
    expect(item.checkOutAt).toBe(CHECK_IN.toISOString());
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockSessionUpdateMany).not.toHaveBeenCalled();
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });

  it("does not audit when a concurrent check-out closes the session first", async () => {
    // The pre-read sees the session open, but the conditional claim inside
    // the transaction matches nothing — another caller closed it first.
    // The re-read returns THEIR close; this call writes no audit event.
    const theirClose = new Date("2026-10-10T04:30:00.000Z");
    mockSessionFindFirst
      .mockResolvedValueOnce(openSessionRow())
      .mockResolvedValue({ ...openSessionRow(), checkOutAt: theirClose });
    mockSessionUpdateMany.mockResolvedValue({ count: 0 });
    mockOrgMembershipFindMany.mockResolvedValue([
      { userId: USER_ID, role: "OWNER" },
    ]);

    const item = await checkOutMember(USER_ID, SESSION_ID, { now: NOW });
    expect(item.checkOutAt).toBe(theirClose.toISOString());
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });

  it("treats a session from another organization as not found", async () => {
    mockSessionFindFirst.mockResolvedValue(null);
    await expect(
      checkOutMember(USER_ID, "other-org-session-id", { now: NOW }),
    ).rejects.toBeInstanceOf(AttendanceNotFoundError);
    expect(mockSessionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "other-org-session-id", organizationId: ORG_ID },
      }),
    );
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it.each(["TRAINER", "MEMBER"])("refuses check-out for role %s", async (role) => {
    mockRoleScope(role);
    await expect(
      checkOutMember(USER_ID, SESSION_ID, { now: NOW }),
    ).rejects.toBeInstanceOf(AttendanceAuthorizationError);
    expect(mockSessionFindFirst).not.toHaveBeenCalled();
  });
});

describe("checkOutAllOpenSessions", () => {
  it("closes only the caller's org open sessions and audits each actual close", async () => {
    const open = [
      { id: "session-1", memberId: MEMBER_ID },
      { id: "session-2", memberId: "member-2" },
    ];
    mockTxSessionFindMany.mockResolvedValue(open);
    mockSessionUpdateMany.mockResolvedValue({ count: 1 });
    mockAuditLogCreate.mockResolvedValue({ id: "audit-id" });

    const { closedCount } = await checkOutAllOpenSessions(USER_ID, { now: NOW });
    expect(closedCount).toBe(2);

    // The query itself is organization-scoped and open-only.
    expect(mockTxSessionFindMany).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID, checkOutAt: null },
      select: { id: true, memberId: true },
    });
    expect(mockSessionUpdateMany).toHaveBeenCalledTimes(2);
    expect(mockAuditLogCreate).toHaveBeenCalledTimes(2);
    for (const [index, session] of open.entries()) {
      // Each close is claimed conditionally (still-open rows only).
      expect(mockSessionUpdateMany.mock.calls[index]?.[0]).toEqual({
        where: { id: session.id, organizationId: ORG_ID, checkOutAt: null },
        data: { checkOutAt: NOW },
      });
      expect(mockAuditLogCreate.mock.calls[index]?.[0].data).toMatchObject({
        event: "ATTENDANCE_CHECKED_OUT",
        targetType: "AttendanceSession",
        targetId: session.id,
      });
      expect(mockAuditLogCreate.mock.calls[index]?.[0].data.metadata).toEqual({
        memberId: session.memberId,
        endOfDay: true,
      });
    }
  });

  it("closes nothing and audits nothing when nobody is in the gym", async () => {
    mockTxSessionFindMany.mockResolvedValue([]);
    const { closedCount } = await checkOutAllOpenSessions(USER_ID, { now: NOW });
    expect(closedCount).toBe(0);
    expect(mockSessionUpdateMany).not.toHaveBeenCalled();
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });

  it("skips (and does not audit) a session a concurrent check-out closed first", async () => {
    const open = [
      { id: "session-1", memberId: MEMBER_ID },
      { id: "session-2", memberId: "member-2" },
    ];
    mockTxSessionFindMany.mockResolvedValue(open);
    // session-1: this call wins the claim. session-2: already closed by a
    // concurrent check-out between the read and the claim — count 0.
    mockSessionUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    mockAuditLogCreate.mockResolvedValue({ id: "audit-id" });

    const { closedCount } = await checkOutAllOpenSessions(USER_ID, { now: NOW });
    expect(closedCount).toBe(1);
    expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
    expect(mockAuditLogCreate.mock.calls[0]?.[0].data).toMatchObject({
      event: "ATTENDANCE_CHECKED_OUT",
      targetId: "session-1",
    });
  });

  it.each(["TRAINER", "MEMBER"])("refuses role %s", async (role) => {
    mockRoleScope(role);
    await expect(
      checkOutAllOpenSessions(USER_ID, { now: NOW }),
    ).rejects.toBeInstanceOf(AttendanceAuthorizationError);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

describe("getOpenSession", () => {
  it("returns the open session DTO with the actor's role", async () => {
    mockMemberFindFirst.mockResolvedValue({ id: MEMBER_ID });
    mockSessionFindFirst.mockResolvedValue({
      id: SESSION_ID,
      memberId: MEMBER_ID,
      checkedInBy: USER_ID,
      source: "MANUAL",
      checkInAt: CHECK_IN,
      checkOutAt: null,
    });
    mockOrgMembershipFindMany.mockResolvedValue([
      { userId: USER_ID, role: "STAFF" },
    ]);
    const item = await getOpenSession(USER_ID, MEMBER_ID);
    expect(item).toMatchObject({
      id: SESSION_ID,
      checkInAt: CHECK_IN.toISOString(),
      checkOutAt: null,
      checkedInByRole: "STAFF",
    });
  });

  it("returns null for a member of another organization", async () => {
    mockMemberFindFirst.mockResolvedValue(null);
    await expect(getOpenSession(USER_ID, "other-org-member")).resolves.toBeNull();
    expect(mockSessionFindFirst).not.toHaveBeenCalled();
  });

  it("lets TRAINER view but returns null for MEMBER role", async () => {
    mockMemberFindFirst.mockResolvedValue({ id: MEMBER_ID });
    mockSessionFindFirst.mockResolvedValue(null);
    mockRoleScope("TRAINER");
    await expect(getOpenSession(USER_ID, MEMBER_ID)).resolves.toBeNull();
    mockRoleScope("MEMBER");
    await expect(getOpenSession(USER_ID, MEMBER_ID)).resolves.toBeNull();
    // MEMBER never reached the member lookup.
    expect(mockMemberFindFirst).toHaveBeenCalledTimes(1);
  });
});

describe("listMemberAttendance", () => {
  it("returns tenant-scoped history, newest first, capped at the limit", async () => {
    mockMemberFindFirst.mockResolvedValue({ id: MEMBER_ID });
    mockSessionFindMany.mockResolvedValue([
      {
        id: SESSION_ID,
        memberId: MEMBER_ID,
        checkedInBy: USER_ID,
        source: "MANUAL",
        checkInAt: CHECK_IN,
        checkOutAt: NOW,
      },
    ]);
    mockOrgMembershipFindMany.mockResolvedValue([
      { userId: USER_ID, role: "ADMIN" },
    ]);

    const items = await listMemberAttendance(USER_ID, MEMBER_ID, 10);
    expect(mockSessionFindMany).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID, memberId: MEMBER_ID },
      orderBy: { checkInAt: "desc" },
      take: 10,
    });
    expect(items).toEqual([
      {
        id: SESSION_ID,
        memberId: MEMBER_ID,
        checkInAt: CHECK_IN.toISOString(),
        checkOutAt: NOW.toISOString(),
        source: "MANUAL",
        checkedInByRole: "ADMIN",
      },
    ]);
  });

  it("returns null for a member of another organization", async () => {
    mockMemberFindFirst.mockResolvedValue(null);
    await expect(
      listMemberAttendance(USER_ID, "other-org-member"),
    ).resolves.toBeNull();
    expect(mockSessionFindMany).not.toHaveBeenCalled();
  });
});

describe("listTodayAttendance", () => {
  it("queries with the Asia/Kolkata day bounds for an instant near IST midnight", async () => {
    // 18:29:59Z is 23:59:59 IST — the Kolkata day still runs to 18:30Z.
    const now = new Date("2026-10-10T18:29:59.000Z");
    const bounds = getKolkataDayBoundsUtc(now);
    mockSessionFindMany.mockResolvedValue([
      {
        id: SESSION_ID,
        memberId: MEMBER_ID,
        checkedInBy: USER_ID,
        source: "MANUAL",
        checkInAt: new Date("2026-10-10T02:00:00.000Z"),
        checkOutAt: null,
        member: { name: "Asha Rao" },
      },
    ]);

    const items = await listTodayAttendance(USER_ID, { now });
    expect(mockSessionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: ORG_ID,
          checkInAt: { gte: bounds.startUtc, lt: bounds.endUtc },
        },
        orderBy: { checkInAt: "desc" },
      }),
    );
    expect(bounds.startUtc.toISOString()).toBe("2026-10-09T18:30:00.000Z");
    expect(bounds.endUtc.toISOString()).toBe("2026-10-10T18:30:00.000Z");
    expect(items[0]).toMatchObject({
      id: SESSION_ID,
      memberName: "Asha Rao",
      checkOutAt: null,
    });
  });

  it("lets TRAINER view today's attendance", async () => {
    mockRoleScope("TRAINER");
    mockSessionFindMany.mockResolvedValue([]);
    await expect(listTodayAttendance(USER_ID, { now: NOW })).resolves.toEqual([]);
  });

  it("refuses MEMBER role", async () => {
    mockRoleScope("MEMBER");
    await expect(
      listTodayAttendance(USER_ID, { now: NOW }),
    ).rejects.toBeInstanceOf(AttendanceAuthorizationError);
    expect(mockSessionFindMany).not.toHaveBeenCalled();
  });
});
