import "server-only";

import {
  Prisma,
  type AttendanceSource,
  type Role,
} from "@prisma/client";

import { getKolkataDayBoundsUtc } from "../attendance";
import { deriveMembershipStatus, type MembershipStatus } from "../members";
import {
  AUDIT_EVENT_ATTENDANCE_CHECKED_OUT,
  AUDIT_EVENT_ATTENDANCE_MANUALLY_ADDED,
  writeAuditEvent,
} from "./audit";
import { getPrimaryMembership } from "./authorization";
import { db } from "./db";

/**
 * Server-side Attendance service (Attendance V1 — Slice 1: staff manual
 * check-in/check-out + history; 04-DATABASE-DESIGN §18 attendance
 * sessions; docs/05-AUTHORIZATION.md §8 V1 permission matrix).
 *
 * An attendance session is one gym visit. Open vs closed is derived from
 * checkOutAt (NULL = still in the gym) — there is no status column.
 *
 * Tenant isolation follows the members/payments pattern: the
 * organization is resolved from the authenticated user's own membership
 * — never from client input — and every lookup carries the organization
 * ID, so a member or session from another organization is
 * indistinguishable from a missing one.
 *
 * One open session per member per gym is guaranteed by the database
 * (partial unique index attendance_sessions_one_open_per_member); the
 * application pre-check only produces the friendly error in the common
 * case, and a raced duplicate surfaces as P2002 and is translated to the
 * same error.
 *
 * Permission model (matrix §8, as approved for this slice):
 * - Check in / check out: OWNER, ADMIN, STAFF.
 * - View attendance: OWNER, ADMIN, STAFF, TRAINER (view-only).
 *
 * Check-in against an EXPIRED membership is never silent in either
 * direction: without an explicit staff confirmation it fails with
 * AttendanceConfirmationRequiredError; the confirmation flow re-derives
 * the status server-side on every submission. A member with NO
 * membership on record cannot be checked in at all (no override).
 */

/** Thrown when the caller lacks permission or the tenant scope fails. */
export class AttendanceAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttendanceAuthorizationError";
  }
}

/** Thrown when the member/session cannot be found in the caller's org. */
export class AttendanceNotFoundError extends Error {
  constructor(message = "Member not found.") {
    super(message);
    this.name = "AttendanceNotFoundError";
  }
}

/** Thrown when the member already has an open attendance session. */
export class AttendanceAlreadyCheckedInError extends Error {
  constructor() {
    super("This member is already checked in.");
    this.name = "AttendanceAlreadyCheckedInError";
  }
}

/** Thrown when the member has no membership record to check in against. */
export class AttendanceNoMembershipError extends Error {
  constructor() {
    super("This member has no membership on record.");
    this.name = "AttendanceNoMembershipError";
  }
}

/**
 * Thrown when the member's latest membership is EXPIRED and the staff
 * user has not explicitly confirmed the check-in. Carries the membership
 * expiry date ("YYYY-MM-DD") so the UI can show exactly what expired.
 */
export class AttendanceConfirmationRequiredError extends Error {
  membershipExpiredOn: string;

  constructor(membershipExpiredOn: string) {
    super("This member's membership has expired.");
    this.name = "AttendanceConfirmationRequiredError";
    this.membershipExpiredOn = membershipExpiredOn;
  }
}

export interface AttendancePermissions {
  canView: boolean;
  canManage: boolean;
}

/** Roles allowed to record attendance (check in/out) in V1. */
export function canManageAttendance(role: Role): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "STAFF";
}

/** Roles allowed to view attendance: staff roles plus TRAINER (view-only). */
export function canViewAttendance(role: Role): boolean {
  return canManageAttendance(role) || role === "TRAINER";
}

export function getAttendancePermissions(
  role: Role,
): AttendancePermissions {
  return { canView: canViewAttendance(role), canManage: canManageAttendance(role) };
}

interface AttendanceScope {
  userId: string;
  organizationId: string;
  role: Role;
}

/**
 * Resolve the caller's tenant scope from their own organization membership.
 * The organization ID is never accepted from the caller.
 */
async function resolveScope(userId: string): Promise<AttendanceScope> {
  if (!userId) {
    throw new AttendanceAuthorizationError("Authentication is required.");
  }
  const membership = await getPrimaryMembership(userId);
  if (!membership) {
    throw new AttendanceAuthorizationError(
      "You do not belong to an organization.",
    );
  }
  return {
    userId,
    organizationId: membership.organizationId,
    role: membership.role,
  };
}

/** UTC Date → "YYYY-MM-DD" (membership dates are stored as @db.Date). */
function toDateString(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface AttendanceSessionItem {
  id: string;
  memberId: string;
  /** ISO timestamp of the check-in. */
  checkInAt: string;
  /** ISO timestamp of the check-out, or null while the member is in the gym. */
  checkOutAt: string | null;
  source: AttendanceSource;
  /** Role of the user who recorded the check-in, if known. */
  checkedInByRole: Role | null;
}

export interface TodayAttendanceItem extends AttendanceSessionItem {
  memberName: string;
}

interface SessionRow {
  id: string;
  memberId: string;
  checkInAt: Date;
  checkOutAt: Date | null;
  source: AttendanceSource;
  checkedInBy: string;
}

/**
 * Resolve the check-in actors of the given sessions to their roles in
 * this organization (the application User record carries no display
 * name) — the same approach as payment history's confirmer roles.
 */
async function actorRolesByUserId(
  organizationId: string,
  sessions: SessionRow[],
): Promise<Map<string, Role>> {
  const actorIds = [...new Set(sessions.map((s) => s.checkedInBy))];
  if (actorIds.length === 0) return new Map();
  const memberships = await db.organizationMembership.findMany({
    where: { organizationId, userId: { in: actorIds } },
    select: { userId: true, role: true },
  });
  return new Map(memberships.map((m) => [m.userId, m.role]));
}

function toSessionItem(
  session: SessionRow,
  roleByUserId: Map<string, Role>,
): AttendanceSessionItem {
  return {
    id: session.id,
    memberId: session.memberId,
    checkInAt: session.checkInAt.toISOString(),
    checkOutAt: session.checkOutAt ? session.checkOutAt.toISOString() : null,
    source: session.source,
    checkedInByRole: roleByUserId.get(session.checkedInBy) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Check-in
// ---------------------------------------------------------------------------

/**
 * Check a member in to the gym (staff-recorded, source MANUAL).
 *
 * The session and its ATTENDANCE_MANUALLY_ADDED audit event are written
 * in one transaction (ADR 017). Membership status is derived server-side
 * from the member's latest membership on every call:
 * - no membership → AttendanceNoMembershipError (no override exists);
 * - EXPIRED without `confirmExpiredMembership` →
 *   AttendanceConfirmationRequiredError (nothing is written);
 * - EXPIRED with confirmation → checked in, and the audit metadata
 *   records that the expired check-in was explicitly confirmed.
 */
export async function checkInMember(
  userId: string,
  memberId: string,
  opts: { confirmExpiredMembership?: boolean; now?: Date } = {},
): Promise<{ sessionId: string }> {
  const scope = await resolveScope(userId);
  if (!canManageAttendance(scope.role)) {
    throw new AttendanceAuthorizationError(
      "You do not have permission to manage attendance.",
    );
  }
  const now = opts.now ?? new Date();

  const member = await db.member.findFirst({
    where: { id: memberId, organizationId: scope.organizationId },
    select: { id: true },
  });
  if (!member) {
    throw new AttendanceNotFoundError();
  }

  // Friendly pre-check; the partial unique index is the real guarantee
  // against concurrent duplicates (its P2002 is translated below).
  const openSession = await db.attendanceSession.findFirst({
    where: {
      organizationId: scope.organizationId,
      memberId: member.id,
      checkOutAt: null,
    },
    select: { id: true },
  });
  if (openSession) {
    throw new AttendanceAlreadyCheckedInError();
  }

  const membership = await db.membership.findFirst({
    where: { memberId: member.id, organizationId: scope.organizationId },
    orderBy: { createdAt: "desc" },
    select: { id: true, expiryDate: true },
  });
  if (!membership) {
    throw new AttendanceNoMembershipError();
  }

  const status: MembershipStatus = deriveMembershipStatus(
    membership.expiryDate,
    now,
  );
  if (status === "EXPIRED" && !opts.confirmExpiredMembership) {
    throw new AttendanceConfirmationRequiredError(
      toDateString(membership.expiryDate),
    );
  }

  let sessionId: string;
  try {
    sessionId = await db.$transaction(async (tx) => {
      const session = await tx.attendanceSession.create({
        data: {
          organizationId: scope.organizationId,
          memberId: member.id,
          checkedInBy: scope.userId,
          source: "MANUAL",
          checkInAt: now,
        },
        select: { id: true },
      });
      await writeAuditEvent(tx, {
        organizationId: scope.organizationId,
        actorUserId: scope.userId,
        event: AUDIT_EVENT_ATTENDANCE_MANUALLY_ADDED,
        targetType: "AttendanceSession",
        targetId: session.id,
        metadata: {
          memberId: member.id,
          membershipId: membership.id,
          membershipStatus: status,
          expiredConfirmation: status === "EXPIRED",
        },
      });
      return session.id;
    });
  } catch (error) {
    // A concurrent check-in won the race: the partial unique index
    // rejected this insert. The member is checked in exactly once.
    if (isUniqueViolation(error)) {
      throw new AttendanceAlreadyCheckedInError();
    }
    throw error;
  }

  return { sessionId };
}

// ---------------------------------------------------------------------------
// Check-out
// ---------------------------------------------------------------------------

/**
 * Check a member out of the gym.
 *
 * Idempotent: checking out an already-closed session returns it unchanged
 * and writes NO second audit event — a double submission is a no-op, not
 * an error, and never duplicates history. The close itself is claimed with
 * a conditional update (only a still-open session transitions), so even
 * two concurrent check-outs produce exactly one close and one audit event.
 */
export async function checkOutMember(
  userId: string,
  sessionId: string,
  opts: { now?: Date } = {},
): Promise<AttendanceSessionItem> {
  const scope = await resolveScope(userId);
  if (!canManageAttendance(scope.role)) {
    throw new AttendanceAuthorizationError(
      "You do not have permission to manage attendance.",
    );
  }
  const now = opts.now ?? new Date();

  const session = await db.attendanceSession.findFirst({
    where: { id: sessionId, organizationId: scope.organizationId },
  });
  if (!session) {
    throw new AttendanceNotFoundError("Attendance session not found.");
  }
  if (session.checkOutAt) {
    const roleByUserId = await actorRolesByUserId(scope.organizationId, [
      session,
    ]);
    return toSessionItem(session, roleByUserId);
  }

  // Claim the close atomically: the conditional update only transitions
  // a session that is still open. If a concurrent check-out closed it
  // first, the claim matches nothing — this call then behaves exactly
  // like the idempotent path above (returns the session, no audit).
  const claimed = await db.$transaction(async (tx) => {
    const claim = await tx.attendanceSession.updateMany({
      where: {
        id: session.id,
        organizationId: scope.organizationId,
        checkOutAt: null,
      },
      data: { checkOutAt: now },
    });
    if (claim.count !== 1) {
      return false;
    }
    await writeAuditEvent(tx, {
      organizationId: scope.organizationId,
      actorUserId: scope.userId,
      event: AUDIT_EVENT_ATTENDANCE_CHECKED_OUT,
      targetType: "AttendanceSession",
      targetId: session.id,
      metadata: { memberId: session.memberId },
    });
    return true;
  });

  if (!claimed) {
    const current = await db.attendanceSession.findFirst({
      where: { id: session.id, organizationId: scope.organizationId },
    });
    if (!current) {
      throw new AttendanceNotFoundError("Attendance session not found.");
    }
    const roleByUserId = await actorRolesByUserId(scope.organizationId, [
      current,
    ]);
    return toSessionItem(current, roleByUserId);
  }

  const updated = { ...session, checkOutAt: now };
  const roleByUserId = await actorRolesByUserId(scope.organizationId, [updated]);
  return toSessionItem(updated, roleByUserId);
}

/**
 * End-of-day: close every open session in the caller's organization.
 *
 * Only the caller's own organization is touched (the scope comes from
 * their membership), and each session that actually closes gets its own
 * ATTENDANCE_CHECKED_OUT audit event marked endOfDay — all in one
 * transaction, so the gym is never left half-closed.
 */
export async function checkOutAllOpenSessions(
  userId: string,
  opts: { now?: Date } = {},
): Promise<{ closedCount: number }> {
  const scope = await resolveScope(userId);
  if (!canManageAttendance(scope.role)) {
    throw new AttendanceAuthorizationError(
      "You do not have permission to manage attendance.",
    );
  }
  const now = opts.now ?? new Date();

  const closedCount = await db.$transaction(async (tx) => {
    const openSessions = await tx.attendanceSession.findMany({
      where: { organizationId: scope.organizationId, checkOutAt: null },
      select: { id: true, memberId: true },
    });
    let closed = 0;
    for (const open of openSessions) {
      // Claim each close atomically: only a session still open at update
      // time is transitioned (and audited) by this call. A session a
      // concurrent check-out closed first is skipped — it was not closed
      // by this action and must not be audited as if it were.
      const claim = await tx.attendanceSession.updateMany({
        where: {
          id: open.id,
          organizationId: scope.organizationId,
          checkOutAt: null,
        },
        data: { checkOutAt: now },
      });
      if (claim.count !== 1) {
        continue;
      }
      await writeAuditEvent(tx, {
        organizationId: scope.organizationId,
        actorUserId: scope.userId,
        event: AUDIT_EVENT_ATTENDANCE_CHECKED_OUT,
        targetType: "AttendanceSession",
        targetId: open.id,
        metadata: { memberId: open.memberId, endOfDay: true },
      });
      closed += 1;
    }
    return closed;
  });

  return { closedCount };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The member's currently open session inside the caller's organization,
 * or null when the member is not in the gym, does not exist in the
 * organization, or the caller's role may not view attendance — all
 * indistinguishable (no IDOR oracle).
 */
export async function getOpenSession(
  userId: string,
  memberId: string,
): Promise<AttendanceSessionItem | null> {
  const scope = await resolveScope(userId);
  if (!canViewAttendance(scope.role)) {
    return null;
  }
  const member = await db.member.findFirst({
    where: { id: memberId, organizationId: scope.organizationId },
    select: { id: true },
  });
  if (!member) return null;

  const session = await db.attendanceSession.findFirst({
    where: {
      organizationId: scope.organizationId,
      memberId: member.id,
      checkOutAt: null,
    },
  });
  if (!session) return null;

  const roleByUserId = await actorRolesByUserId(scope.organizationId, [session]);
  return toSessionItem(session, roleByUserId);
}

/**
 * A member's attendance history inside the caller's organization, newest
 * first. Returns null when the member does not exist in the organization
 * or the caller's role may not view attendance.
 */
export async function listMemberAttendance(
  userId: string,
  memberId: string,
  limit = 30,
): Promise<AttendanceSessionItem[] | null> {
  const scope = await resolveScope(userId);
  if (!canViewAttendance(scope.role)) {
    return null;
  }
  const member = await db.member.findFirst({
    where: { id: memberId, organizationId: scope.organizationId },
    select: { id: true },
  });
  if (!member) return null;

  const sessions = await db.attendanceSession.findMany({
    where: { organizationId: scope.organizationId, memberId: member.id },
    orderBy: { checkInAt: "desc" },
    take: Math.max(1, Math.floor(limit)),
  });
  const roleByUserId = await actorRolesByUserId(scope.organizationId, sessions);
  return sessions.map((session) => toSessionItem(session, roleByUserId));
}

/**
 * Today's attendance for the caller's gym: every session whose check-in
 * falls inside the Asia/Kolkata calendar day containing `now` (default:
 * the current instant), newest first. Day boundaries are gym-local
 * (Kolkata), converted to UTC bounds for the query.
 */
export async function listTodayAttendance(
  userId: string,
  opts: { now?: Date } = {},
): Promise<TodayAttendanceItem[]> {
  const scope = await resolveScope(userId);
  if (!canViewAttendance(scope.role)) {
    throw new AttendanceAuthorizationError(
      "You do not have permission to view attendance.",
    );
  }
  const { startUtc, endUtc } = getKolkataDayBoundsUtc(opts.now ?? new Date());

  const sessions = await db.attendanceSession.findMany({
    where: {
      organizationId: scope.organizationId,
      checkInAt: { gte: startUtc, lt: endUtc },
    },
    orderBy: { checkInAt: "desc" },
    include: { member: { select: { name: true } } },
  });
  const roleByUserId = await actorRolesByUserId(scope.organizationId, sessions);
  return sessions.map((session) => ({
    ...toSessionItem(session, roleByUserId),
    memberName: session.member.name,
  }));
}
