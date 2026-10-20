import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const {
  mockTransaction,
  mockOrgMembershipFindMany,
  mockMemberFindFirst,
  mockMembershipFindFirst,
  mockSessionFindFirst,
  mockSessionFindMany,
  mockSessionCreate,
  mockAuditLogCreate,
} = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockOrgMembershipFindMany: vi.fn(),
  mockMemberFindFirst: vi.fn(),
  mockMembershipFindFirst: vi.fn(),
  mockSessionFindFirst: vi.fn(),
  mockSessionFindMany: vi.fn(),
  mockSessionCreate: vi.fn(),
  mockAuditLogCreate: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({
  db: {
    organizationMembership: {
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

// Mirrors the staff attendance harness: only the Clerk-touching auth
// module is stubbed out; the self path must never reach it (nor the
// Clerk-side scope resolution) — the context below is the whole input.
vi.mock("@/lib/server/auth", () => ({
  getCurrentUser: vi.fn(),
}));

import type { MemberSessionContext } from "@/lib/server/member-session";
import {
  AttendanceAlreadyCheckedInError,
  AttendanceMembershipExpiredError,
  AttendanceNoMembershipError,
  AttendanceNotFoundError,
  checkInSelf,
  getOwnAttendancePage,
  getOwnOpenSession,
  listOwnAttendance,
} from "@/lib/server/attendance";

const SELF_USER_ID = "1a2b3c4d-5e6f-47a8-b9c0-0a1b2c3d4e5f";
const ORG_ID = "c3298d3b-a07f-33eb-de2b-00333455cf3f";
const MEMBER_ID = "f65a9b4e-d21c-44de-bc3d-00666788ef4f";
const MEMBERSHIP_ID = "d47a1c5b-8e3f-4a2b-9c1d-001122334455";
const SESSION_ID = "a12b3c4d-5e6f-47a8-b9c0-0a1b2c3d4e5f";
const STAFF_USER_ID = "b2198c2a-f96e-22da-cd1a-00222444be2e";

// Fixed "now" for every test: 2026-10-10 05:00 UTC (10:30 IST).
const NOW = new Date("2026-10-10T05:00:00.000Z");
const CHECK_IN = new Date("2026-10-10T01:00:00.000Z");

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

const ACTIVE_EXPIRY = utcDate(2026, 11, 9);
const EXPIRING_EXPIRY = utcDate(2026, 10, 12);
const EXPIRED_EXPIRY = utcDate(2026, 10, 9);

/**
 * A verified member-session context as resolveMemberSession would
 * produce it: the gym, the user, and their linked Member record are all
 * fixed by the session — the fixtures below only vary the Member.
 */
function memberContext(member: unknown): MemberSessionContext {
  return {
    session: {
      id: "member-session-id",
      userId: SELF_USER_ID,
      organizationId: ORG_ID,
    },
    user: { id: SELF_USER_ID },
    organization: { id: ORG_ID },
    membership: {
      userId: SELF_USER_ID,
      organizationId: ORG_ID,
      role: "MEMBER",
    },
    member,
  } as unknown as MemberSessionContext;
}

function linkedContext(): MemberSessionContext {
  return memberContext({
    id: MEMBER_ID,
    organizationId: ORG_ID,
    userId: SELF_USER_ID,
  });
}

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "7.10.0",
  });
}

/** No open session; latest membership with the given expiry. */
function mockSelfCheckInScenario(expiryDate: Date | null) {
  mockSessionFindFirst.mockResolvedValue(null);
  mockMembershipFindFirst.mockResolvedValue(
    expiryDate ? { id: MEMBERSHIP_ID, expiryDate } : null,
  );
  mockSessionCreate.mockResolvedValue({ id: SESSION_ID });
  mockAuditLogCreate.mockResolvedValue({ id: "audit-id" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOrgMembershipFindMany.mockResolvedValue([]);
  mockTransaction.mockImplementation(async (cb: never) =>
    (cb as (tx: unknown) => Promise<unknown>)({
      attendanceSession: { create: mockSessionCreate },
      auditLog: { create: mockAuditLogCreate },
    }),
  );
});

describe("checkInSelf", () => {
  it("checks the member in with source QR, actor and scope taken only from the context, and writes NO audit event", async () => {
    mockSelfCheckInScenario(ACTIVE_EXPIRY);

    const result = await checkInSelf(linkedContext(), { now: NOW });
    expect(result).toEqual({ sessionId: SESSION_ID });

    // Member identity comes from the context — no member lookup by ID
    // is (or may be) performed.
    expect(mockMemberFindFirst).not.toHaveBeenCalled();
    // The membership lookup is bound to the context's member + gym.
    expect(mockMembershipFindFirst).toHaveBeenCalledWith({
      where: { memberId: MEMBER_ID, organizationId: ORG_ID },
      orderBy: { createdAt: "desc" },
      select: { id: true, expiryDate: true },
    });
    expect(mockSessionCreate).toHaveBeenCalledWith({
      data: {
        organizationId: ORG_ID,
        memberId: MEMBER_ID,
        checkedInBy: SELF_USER_ID,
        source: "QR",
        checkInAt: NOW,
      },
      select: { id: true },
    });
    // ADR 017 §45 / decision D-C: normal self-check-in is not audited.
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });

  it("fails with AlreadyCheckedIn when an open session exists (pre-check)", async () => {
    mockSelfCheckInScenario(ACTIVE_EXPIRY);
    mockSessionFindFirst.mockResolvedValue({ id: "existing-session" });

    await expect(
      checkInSelf(linkedContext(), { now: NOW }),
    ).rejects.toBeInstanceOf(AttendanceAlreadyCheckedInError);
    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });

  it("translates a raced P2002 (concurrent duplicate) into AlreadyCheckedIn", async () => {
    mockSelfCheckInScenario(ACTIVE_EXPIRY);
    mockSessionCreate.mockRejectedValue(uniqueViolation());

    await expect(
      checkInSelf(linkedContext(), { now: NOW }),
    ).rejects.toBeInstanceOf(AttendanceAlreadyCheckedInError);
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });

  it("BLOCKS an expired membership — and no confirmation input can override it", async () => {
    mockSelfCheckInScenario(EXPIRED_EXPIRY);

    await expect(
      checkInSelf(linkedContext(), { now: NOW }),
    ).rejects.toBeInstanceOf(AttendanceMembershipExpiredError);

    // The self path has no confirmation parameter; even a caller that
    // passes one anyway is blocked identically.
    await expect(
      checkInSelf(linkedContext(), {
        now: NOW,
        confirmExpiredMembership: true,
      } as unknown as { now: Date }),
    ).rejects.toBeInstanceOf(AttendanceMembershipExpiredError);

    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });

  it("allows an EXPIRING membership", async () => {
    mockSelfCheckInScenario(EXPIRING_EXPIRY);
    await expect(
      checkInSelf(linkedContext(), { now: NOW }),
    ).resolves.toEqual({ sessionId: SESSION_ID });
    expect(mockSessionCreate).toHaveBeenCalledTimes(1);
  });

  it("fails with NoMembership when the member has no membership record", async () => {
    mockSelfCheckInScenario(null);

    await expect(
      checkInSelf(linkedContext(), { now: NOW }),
    ).rejects.toBeInstanceOf(AttendanceNoMembershipError);
    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });

  it("fails generically when the context has no linked Member record", async () => {
    await expect(
      checkInSelf(memberContext(null), { now: NOW }),
    ).rejects.toBeInstanceOf(AttendanceNotFoundError);
    // Nothing is looked up or written for an unlinked context.
    expect(mockSessionFindFirst).not.toHaveBeenCalled();
    expect(mockMembershipFindFirst).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });
});

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    organizationId: ORG_ID,
    memberId: MEMBER_ID,
    checkedInBy: SELF_USER_ID,
    source: "QR" as const,
    checkInAt: CHECK_IN,
    checkOutAt: null,
    createdAt: CHECK_IN,
    updatedAt: CHECK_IN,
    ...overrides,
  };
}

describe("listOwnAttendance", () => {
  it("queries ONLY the context's organization + member and maps DTOs", async () => {
    const rows = [
      sessionRow(),
      sessionRow({
        id: "older-session",
        checkedInBy: STAFF_USER_ID,
        source: "MANUAL" as const,
        checkInAt: new Date("2026-10-09T01:00:00.000Z"),
        checkOutAt: new Date("2026-10-09T03:00:00.000Z"),
      }),
    ];
    mockSessionFindMany.mockResolvedValue(rows);
    mockOrgMembershipFindMany.mockResolvedValue([
      { userId: SELF_USER_ID, role: "MEMBER" },
      { userId: STAFF_USER_ID, role: "STAFF" },
    ]);

    const items = await listOwnAttendance(linkedContext());
    expect(mockSessionFindMany).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID, memberId: MEMBER_ID },
      orderBy: { checkInAt: "desc" },
      take: 30,
      select: {
        id: true,
        memberId: true,
        checkInAt: true,
        checkOutAt: true,
        source: true,
        checkedInBy: true,
      },
    });
    expect(items).toHaveLength(2);
    expect(items?.[0]).toEqual({
      id: SESSION_ID,
      memberId: MEMBER_ID,
      checkInAt: CHECK_IN.toISOString(),
      checkOutAt: null,
      source: "QR",
      checkedInByRole: "MEMBER",
    });
    expect(items?.[1]?.checkedInByRole).toBe("STAFF");
    expect(items?.[1]?.checkOutAt).toBe("2026-10-09T03:00:00.000Z");
  });

  it("passes an explicit limit through as the take", async () => {
    mockSessionFindMany.mockResolvedValue([]);
    await listOwnAttendance(linkedContext(), 5);
    expect(mockSessionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 }),
    );
  });

  it("returns null (and queries nothing) when the context has no linked Member", async () => {
    await expect(listOwnAttendance(memberContext(null))).resolves.toBeNull();
    expect(mockSessionFindMany).not.toHaveBeenCalled();
  });
});

describe("getOwnOpenSession", () => {
  it("returns the member's open session, queried with the context ids and checkOutAt null", async () => {
    mockSessionFindFirst.mockResolvedValue(sessionRow());
    mockOrgMembershipFindMany.mockResolvedValue([
      { userId: SELF_USER_ID, role: "MEMBER" },
    ]);

    const item = await getOwnOpenSession(linkedContext());
    expect(mockSessionFindFirst).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_ID,
        memberId: MEMBER_ID,
        checkOutAt: null,
      },
      select: {
        id: true,
        memberId: true,
        checkInAt: true,
        checkOutAt: true,
        source: true,
        checkedInBy: true,
      },
    });
    expect(item).toEqual({
      id: SESSION_ID,
      memberId: MEMBER_ID,
      checkInAt: CHECK_IN.toISOString(),
      checkOutAt: null,
      source: "QR",
      checkedInByRole: "MEMBER",
    });
  });

  it("returns null when the member is not in the gym", async () => {
    mockSessionFindFirst.mockResolvedValue(null);
    await expect(getOwnOpenSession(linkedContext())).resolves.toBeNull();
  });

  it("returns null (and queries nothing) when the context has no linked Member", async () => {
    await expect(getOwnOpenSession(memberContext(null))).resolves.toBeNull();
    expect(mockSessionFindFirst).not.toHaveBeenCalled();
  });
});

describe("getOwnAttendancePage", () => {
  it("resolves actor roles ONCE for the union of the open session and history", async () => {
    mockSessionFindFirst.mockResolvedValue(
      sessionRow({ checkedInBy: STAFF_USER_ID, source: "MANUAL" as const }),
    );
    mockSessionFindMany.mockResolvedValue([
      sessionRow(),
      sessionRow({
        id: "older-session",
        checkedInBy: STAFF_USER_ID,
        source: "MANUAL" as const,
        checkInAt: new Date("2026-10-09T01:00:00.000Z"),
        checkOutAt: new Date("2026-10-09T03:00:00.000Z"),
      }),
    ]);
    mockOrgMembershipFindMany.mockResolvedValue([
      { userId: SELF_USER_ID, role: "MEMBER" },
      { userId: STAFF_USER_ID, role: "STAFF" },
    ]);

    const { openSession, history } = await getOwnAttendancePage(
      linkedContext(),
    );

    expect(mockOrgMembershipFindMany).toHaveBeenCalledTimes(1);
    const roleQuery = mockOrgMembershipFindMany.mock.calls[0]?.[0];
    expect(roleQuery?.where.organizationId).toBe(ORG_ID);
    expect(new Set(roleQuery?.where.userId.in)).toEqual(
      new Set([SELF_USER_ID, STAFF_USER_ID]),
    );
    expect(openSession?.checkedInByRole).toBe("STAFF");
    expect(history).toHaveLength(2);
    expect(history?.[0]?.checkedInByRole).toBe("MEMBER");
    expect(history?.[1]?.checkedInByRole).toBe("STAFF");
  });

  it("queries both session reads with the context ids and the SessionRow select", async () => {
    mockSessionFindFirst.mockResolvedValue(null);
    mockSessionFindMany.mockResolvedValue([]);
    mockOrgMembershipFindMany.mockResolvedValue([]);

    const { openSession, history } = await getOwnAttendancePage(
      linkedContext(),
    );

    const select = {
      id: true,
      memberId: true,
      checkInAt: true,
      checkOutAt: true,
      source: true,
      checkedInBy: true,
    };
    expect(mockSessionFindFirst).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_ID,
        memberId: MEMBER_ID,
        checkOutAt: null,
      },
      select,
    });
    expect(mockSessionFindMany).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID, memberId: MEMBER_ID },
      orderBy: { checkInAt: "desc" },
      take: 30,
      select,
    });
    expect(openSession).toBeNull();
    expect(history).toEqual([]);
  });

  it("returns null history (and queries nothing) when the context has no linked Member", async () => {
    await expect(
      getOwnAttendancePage(memberContext(null)),
    ).resolves.toEqual({ openSession: null, history: null });
    expect(mockSessionFindFirst).not.toHaveBeenCalled();
    expect(mockSessionFindMany).not.toHaveBeenCalled();
  });

  it("returns history with roles resolved once when there is no open session", async () => {
    mockSessionFindFirst.mockResolvedValue(null);
    mockSessionFindMany.mockResolvedValue([
      sessionRow(),
      sessionRow({
        id: "older-session",
        checkedInBy: STAFF_USER_ID,
        source: "MANUAL" as const,
        checkInAt: new Date("2026-10-09T01:00:00.000Z"),
        checkOutAt: new Date("2026-10-09T03:00:00.000Z"),
      }),
    ]);
    mockOrgMembershipFindMany.mockResolvedValue([
      { userId: SELF_USER_ID, role: "MEMBER" },
      { userId: STAFF_USER_ID, role: "STAFF" },
    ]);

    const { openSession, history } = await getOwnAttendancePage(
      linkedContext(),
    );

    expect(openSession).toBeNull();
    expect(history).toHaveLength(2);
    expect(history?.[0]).toEqual({
      id: SESSION_ID,
      memberId: MEMBER_ID,
      checkInAt: CHECK_IN.toISOString(),
      checkOutAt: null,
      source: "QR",
      checkedInByRole: "MEMBER",
    });
    expect(history?.[1]?.checkedInByRole).toBe("STAFF");
    expect(history?.[1]?.checkOutAt).toBe("2026-10-09T03:00:00.000Z");
    expect(mockOrgMembershipFindMany).toHaveBeenCalledTimes(1);
    const roleQuery = mockOrgMembershipFindMany.mock.calls[0]?.[0];
    expect(roleQuery?.where.organizationId).toBe(ORG_ID);
    expect(new Set(roleQuery?.where.userId.in)).toEqual(
      new Set([SELF_USER_ID, STAFF_USER_ID]),
    );
  });
});
