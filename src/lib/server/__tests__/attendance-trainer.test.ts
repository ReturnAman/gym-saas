import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockTransaction,
  mockOrgMembershipFindFirst,
  mockOrgMembershipFindMany,
  mockMemberFindFirst,
  mockMembershipFindFirst,
  mockSessionFindFirst,
  mockSessionCreate,
  mockSessionUpdate,
  mockSessionUpdateMany,
  mockTxSessionFindMany,
  mockPaymentCreate,
  mockPaymentGroupBy,
  mockAuditLogCreate,
} = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockOrgMembershipFindFirst: vi.fn(),
  mockOrgMembershipFindMany: vi.fn(),
  mockMemberFindFirst: vi.fn(),
  mockMembershipFindFirst: vi.fn(),
  mockSessionFindFirst: vi.fn(),
  mockSessionCreate: vi.fn(),
  mockSessionUpdate: vi.fn(),
  mockSessionUpdateMany: vi.fn(),
  mockTxSessionFindMany: vi.fn(),
  mockPaymentCreate: vi.fn(),
  mockPaymentGroupBy: vi.fn(),
  mockAuditLogCreate: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({
  db: {
    organizationSubscription: { findUnique: vi.fn(async () => ({ suspendedAt: null, paidThroughAt: null, trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60_000) })) },
    organizationMembership: {
      findFirst: mockOrgMembershipFindFirst,
      findMany: mockOrgMembershipFindMany,
    },
    member: { findFirst: mockMemberFindFirst },
    membership: { findFirst: mockMembershipFindFirst },
    attendanceSession: {
      findFirst: mockSessionFindFirst,
      findMany: vi.fn(),
    },
    payment: { groupBy: mockPaymentGroupBy },
    $transaction: mockTransaction,
  },
}));

// The real getPrimaryMembership runs against the mocked db above; only the
// Clerk-touching auth module is stubbed out.
vi.mock("@/lib/server/auth", () => ({
  getCurrentUser: vi.fn(),
}));

import {
  AttendanceAlreadyCheckedInError,
  AttendanceAuthorizationError,
  AttendanceConfirmationRequiredError,
  checkInMember,
  checkOutAllOpenSessions,
  checkOutMember,
} from "@/lib/server/attendance";
import {
  PaymentAuthorizationError,
  recordPayment,
} from "@/lib/server/payments";

/**
 * TRAINER manual check-in (Slice 2 QR revision, ADR 022): a trainer may
 * record a check-in on a member's behalf — the front-desk path for a
 * member without a phone — through exactly the staff flow (validation,
 * expired-membership confirmation, ATTENDANCE_MANUALLY_ADDED audit,
 * one-open-session protection), with the trainer recorded as the actor.
 * The widening is check-in ONLY: check-out, end-of-day, and unrelated
 * writes (payments) remain closed to trainers.
 */

// A TRAINER user distinct from the staff USER_ID of the main suite, so
// the actor assertions prove the trainer — not just any user — is
// recorded.
const TRAINER_ID = "1a2b3c4d-5e6f-47a8-b9c0-112233445566";
const ORG_ID = "c3298d3b-a07f-33eb-de2b-00333455cf3f";
const MEMBER_ID = "f65a9b4e-d21c-44de-bc3d-00666788ef4f";
const MEMBERSHIP_ID = "d47a1c5b-8e3f-4a2b-9c1d-001122334455";
const SESSION_ID = "a12b3c4d-5e6f-47a8-b9c0-0a1b2c3d4e5f";

// Fixed "now": 2026-10-10 05:00 UTC (10:30 IST), matching the staff suite.
const NOW = new Date("2026-10-10T05:00:00.000Z");

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/** Member present, no open session, membership with the given expiry. */
function mockCheckInScenario(expiryDate: Date) {
  mockMemberFindFirst.mockResolvedValue({ id: MEMBER_ID });
  mockSessionFindFirst.mockResolvedValue(null);
  mockMembershipFindFirst.mockResolvedValue({
    id: MEMBERSHIP_ID,
    expiryDate,
  });
  mockSessionCreate.mockResolvedValue({ id: SESSION_ID });
  mockAuditLogCreate.mockResolvedValue({ id: "audit-id" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOrgMembershipFindFirst.mockResolvedValue({
    userId: TRAINER_ID,
    organizationId: ORG_ID,
    role: "TRAINER",
  });
  mockOrgMembershipFindMany.mockResolvedValue([]);
  mockTransaction.mockImplementation(async (cb: never) =>
    (cb as (tx: unknown) => Promise<unknown>)({
      organizationSubscription: { findUnique: async () => ({ suspendedAt: null, paidThroughAt: null, trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60_000) }) },
      attendanceSession: {
        create: mockSessionCreate,
        update: mockSessionUpdate,
        updateMany: mockSessionUpdateMany,
        findMany: mockTxSessionFindMany,
      },
      payment: { create: mockPaymentCreate },
      auditLog: { create: mockAuditLogCreate },
    }),
  );
});

describe("TRAINER manual check-in", () => {
  it("checks a member in and records the trainer as the actor", async () => {
    mockCheckInScenario(utcDate(2027, 1, 1)); // ACTIVE

    const { sessionId } = await checkInMember(TRAINER_ID, MEMBER_ID, {
      now: NOW,
    });
    expect(sessionId).toBe(SESSION_ID);

    const data = mockSessionCreate.mock.calls[0]?.[0].data;
    expect(data).toEqual({
      organizationId: ORG_ID,
      memberId: MEMBER_ID,
      checkedInBy: TRAINER_ID,
      source: "MANUAL",
      checkInAt: NOW,
    });

    const auditData = mockAuditLogCreate.mock.calls[0]?.[0].data;
    expect(auditData).toMatchObject({
      organizationId: ORG_ID,
      actorUserId: TRAINER_ID,
      event: "ATTENDANCE_MANUALLY_ADDED",
      targetType: "AttendanceSession",
      targetId: SESSION_ID,
    });
  });

  it("still requires explicit confirmation for an EXPIRED membership, then checks in with it", async () => {
    mockCheckInScenario(utcDate(2026, 10, 5)); // expired 5 days before NOW

    const error = await checkInMember(TRAINER_ID, MEMBER_ID, {
      now: NOW,
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AttendanceConfirmationRequiredError);
    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();

    const { sessionId } = await checkInMember(TRAINER_ID, MEMBER_ID, {
      now: NOW,
      confirmExpiredMembership: true,
    });
    expect(sessionId).toBe(SESSION_ID);
    const auditData = mockAuditLogCreate.mock.calls[0]?.[0].data;
    expect(auditData).toMatchObject({
      actorUserId: TRAINER_ID,
      event: "ATTENDANCE_MANUALLY_ADDED",
    });
    expect(auditData.metadata).toEqual({
      memberId: MEMBER_ID,
      membershipId: MEMBERSHIP_ID,
      membershipStatus: "EXPIRED",
      expiredConfirmation: true,
    });
  });

  it("shares the one-open-session duplicate protection", async () => {
    mockMemberFindFirst.mockResolvedValue({ id: MEMBER_ID });
    mockSessionFindFirst.mockResolvedValue({ id: SESSION_ID });
    await expect(
      checkInMember(TRAINER_ID, MEMBER_ID, { now: NOW }),
    ).rejects.toBeInstanceOf(AttendanceAlreadyCheckedInError);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

describe("TRAINER limits — the widening is check-in only", () => {
  it("cannot check a member out", async () => {
    await expect(
      checkOutMember(TRAINER_ID, SESSION_ID, { now: NOW }),
    ).rejects.toBeInstanceOf(AttendanceAuthorizationError);
    expect(mockSessionFindFirst).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("cannot run end-of-day check-out", async () => {
    await expect(
      checkOutAllOpenSessions(TRAINER_ID, { now: NOW }),
    ).rejects.toBeInstanceOf(AttendanceAuthorizationError);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("cannot record a payment (no unrelated write access)", async () => {
    await expect(
      recordPayment(TRAINER_ID, MEMBER_ID, {
        amount: "2500.50",
        paymentMethod: "UPI",
        reference: "",
      }),
    ).rejects.toBeInstanceOf(PaymentAuthorizationError);
    expect(mockPaymentCreate).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
