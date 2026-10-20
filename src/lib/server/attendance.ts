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
import type { MemberSessionContext } from "./member-session";

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
 * Permission model (matrix §8, as approved for this slice; check-in
 * widened by the Slice 2 QR revision, ADR 022):
 * - Check in: OWNER, ADMIN, STAFF, TRAINER — a trainer may record a
 *   manual check-in on a member's behalf (e.g. a member without a
 *   phone), through the same validation, expired-membership
 *   confirmation, audit event, and duplicate protection as staff; the
 *   acting trainer is the recorded actor.
 * - Check out / end-of-day: OWNER, ADMIN, STAFF (unchanged).
 * - View attendance: OWNER, ADMIN, STAFF, TRAINER.
 *
 * Check-in against an EXPIRED membership is never silent in either
 * direction: without an explicit staff confirmation it fails with
 * AttendanceConfirmationRequiredError; the confirmation flow re-derives
 * the status server-side on every submission. A member with NO
 * membership on record cannot be checked in at all (no override).
 *
 * Slice 2 (S1) adds the member self-service path on top of the same
 * check-in core: checkInSelf resolves everything from the verified
 * MemberSessionContext (ADR 021) — never from client input — records
 * source QR, writes NO audit event (ADR 017 §45: attendance rows are
 * the history; only staff manual adds are audited), and BLOCKS an
 * EXPIRED membership outright (AttendanceMembershipExpiredError): a
 * member cannot confirm their own expired check-in; the staff
 * confirmation flow remains the only override.
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

/**
 * Thrown when a member tries to check THEMSELVES in against an EXPIRED
 * membership. Unlike the staff path there is no confirmation override:
 * self-check-in is blocked outright and the member is directed to the
 * front desk, where staff can still check them in via the confirmation
 * flow.
 */
export class AttendanceMembershipExpiredError extends Error {
  constructor() {
    super("This membership has expired.");
    this.name = "AttendanceMembershipExpiredError";
  }
}

export interface AttendancePermissions {
  canView: boolean;
  canManage: boolean;
  canCheckIn: boolean;
}

/** Roles allowed to record attendance (check in/out) in V1. */
export function canManageAttendance(role: Role): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "STAFF";
}

/**
 * Roles allowed to record a manual check-in on a member's behalf: the
 * managing roles plus TRAINER (Slice 2 QR revision, ADR 022). This is
 * deliberately narrower than a general write permission — check-out
 * and end-of-day remain governed by canManageAttendance.
 */
export function canCheckInAttendance(role: Role): boolean {
  return canManageAttendance(role) || role === "TRAINER";
}

/** Roles allowed to view attendance: staff roles plus TRAINER (view-only). */
export function canViewAttendance(role: Role): boolean {
  return canManageAttendance(role) || role === "TRAINER";
}

export function getAttendancePermissions(
  role: Role,
): AttendancePermissions {
  return {
    canView: canViewAttendance(role),
    canManage: canManageAttendance(role),
    canCheckIn: canCheckInAttendance(role),
  };
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
 * The exact columns the member-own attendance reads consume — the
 * SessionRow shape above. Selecting them explicitly keeps the rest
 * of the AttendanceSession row off the wire.
 */
const SESSION_ROW_SELECT = {
  id: true,
  memberId: true,
  checkInAt: true,
  checkOutAt: true,
  source: true,
  checkedInBy: true,
} satisfies Prisma.AttendanceSessionSelect;

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
 * The shared check-in core. Everything it needs is resolved server-side
 * by the caller (staff scope from the caller's own organization
 * membership, or the verified member-session context) — it never
 * accepts an organization or member identifier from client input.
 *
 * Steps, in order:
 * - friendly open-session pre-check (the partial unique index is the
 *   real guarantee; a raced P2002 from the insert is translated to the
 *   same AttendanceAlreadyCheckedInError);
 * - latest membership lookup (tenant-scoped, newest first); no
 *   membership → AttendanceNoMembershipError (no override exists);
 * - membership status derived from that record on every call; EXPIRED
 *   handling depends on the caller's policy:
 *   - "confirm" (staff): without explicit confirmation →
 *     AttendanceConfirmationRequiredError, nothing is written; with
 *     confirmation the check-in proceeds;
 *   - "block" (member self-check-in): AttendanceMembershipExpiredError
 *     regardless of any flag — there is no self-confirmation;
 * - the session (and, for the staff path only, the
 *   ATTENDANCE_MANUALLY_ADDED audit event) is written in one
 *   transaction.
 */
async function createCheckInSession(
  scope: {
    organizationId: string;
    memberId: string;
    actorUserId: string;
    source: AttendanceSource;
  },
  opts: {
    now: Date;
    expiredPolicy: "confirm" | "block";
    confirmExpiredMembership?: boolean;
    audit: "manual" | "none";
  },
): Promise<{ sessionId: string }> {
  const { now } = opts;

  // Friendly pre-check; the partial unique index is the real guarantee
  // against concurrent duplicates (its P2002 is translated below).
  const openSession = await db.attendanceSession.findFirst({
    where: {
      organizationId: scope.organizationId,
      memberId: scope.memberId,
      checkOutAt: null,
    },
    select: { id: true },
  });
  if (openSession) {
    throw new AttendanceAlreadyCheckedInError();
  }

  const membership = await db.membership.findFirst({
    where: { memberId: scope.memberId, organizationId: scope.organizationId },
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
  if (status === "EXPIRED") {
    if (opts.expiredPolicy === "block") {
      throw new AttendanceMembershipExpiredError();
    }
    if (!opts.confirmExpiredMembership) {
      throw new AttendanceConfirmationRequiredError(
        toDateString(membership.expiryDate),
      );
    }
  }

  let sessionId: string;
  try {
    sessionId = await db.$transaction(async (tx) => {
      const session = await tx.attendanceSession.create({
        data: {
          organizationId: scope.organizationId,
          memberId: scope.memberId,
          checkedInBy: scope.actorUserId,
          source: scope.source,
          checkInAt: now,
        },
        select: { id: true },
      });
      if (opts.audit === "manual") {
        await writeAuditEvent(tx, {
          organizationId: scope.organizationId,
          actorUserId: scope.actorUserId,
          event: AUDIT_EVENT_ATTENDANCE_MANUALLY_ADDED,
          targetType: "AttendanceSession",
          targetId: session.id,
          metadata: {
            memberId: scope.memberId,
            membershipId: membership.id,
            membershipStatus: status,
            expiredConfirmation: status === "EXPIRED",
          },
        });
      }
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
  if (!canCheckInAttendance(scope.role)) {
    throw new AttendanceAuthorizationError(
      "You do not have permission to manage attendance.",
    );
  }

  const member = await db.member.findFirst({
    where: { id: memberId, organizationId: scope.organizationId },
    select: { id: true },
  });
  if (!member) {
    throw new AttendanceNotFoundError();
  }

  return createCheckInSession(
    {
      organizationId: scope.organizationId,
      memberId: member.id,
      actorUserId: scope.userId,
      source: "MANUAL",
    },
    {
      now: opts.now ?? new Date(),
      expiredPolicy: "confirm",
      confirmExpiredMembership: opts.confirmExpiredMembership,
      audit: "manual",
    },
  );
}

/**
 * Check the signed-in member THEMSELVES in (QR self-check-in, source QR).
 *
 * Authorization is the verified member session itself (ADR 021): the
 * organization, the member record, and the actor all come from the
 * session context — nothing is accepted from the client, and no Clerk
 * identity is involved. A context whose linked Member record no longer
 * exists fails with the generic not-found error.
 *
 * Differences from the staff path, by design:
 * - NO audit event is written (ADR 017 §45 — normal member check-ins
 *   are not audited; the attendance row is the history);
 * - an EXPIRED membership BLOCKS the check-in
 *   (AttendanceMembershipExpiredError) — there is deliberately no
 *   confirmation parameter anywhere in this path; staff can still check
 *   the member in via the confirmation flow.
 */
export async function checkInSelf(
  context: MemberSessionContext,
  opts: { now?: Date } = {},
): Promise<{ sessionId: string }> {
  const member = context.member;
  if (!member) {
    throw new AttendanceNotFoundError();
  }

  return createCheckInSession(
    {
      organizationId: context.session.organizationId,
      memberId: member.id,
      actorUserId: context.user.id,
      source: "QR",
    },
    {
      now: opts.now ?? new Date(),
      expiredPolicy: "block",
      audit: "none",
    },
  );
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

// ---------------------------------------------------------------------------
// Member self reads (Slice 2) — scoped exclusively to the verified
// member-session context: organization and member come from the session
// row, never from any client-supplied identifier, so another member's
// records are unreachable through these functions.
// ---------------------------------------------------------------------------

/**
 * The signed-in member's OWN attendance history in their session's gym,
 * newest first. Returns null when the context's linked Member record no
 * longer exists.
 */
export async function listOwnAttendance(
  context: MemberSessionContext,
  limit = 30,
): Promise<AttendanceSessionItem[] | null> {
  const member = context.member;
  if (!member) return null;

  const sessions = await db.attendanceSession.findMany({
    where: {
      organizationId: context.session.organizationId,
      memberId: member.id,
    },
    orderBy: { checkInAt: "desc" },
    take: Math.max(1, Math.floor(limit)),
    select: SESSION_ROW_SELECT,
  });
  const roleByUserId = await actorRolesByUserId(
    context.session.organizationId,
    sessions,
  );
  return sessions.map((session) => toSessionItem(session, roleByUserId));
}

/**
 * The signed-in member's OWN currently open session in their session's
 * gym, or null when they are not in the gym or the context's linked
 * Member record no longer exists.
 */
export async function getOwnOpenSession(
  context: MemberSessionContext,
): Promise<AttendanceSessionItem | null> {
  const member = context.member;
  if (!member) return null;

  const session = await db.attendanceSession.findFirst({
    where: {
      organizationId: context.session.organizationId,
      memberId: member.id,
      checkOutAt: null,
    },
    select: SESSION_ROW_SELECT,
  });
  if (!session) return null;

  const roleByUserId = await actorRolesByUserId(
    context.session.organizationId,
    [session],
  );
  return toSessionItem(session, roleByUserId);
}

/**
 * Everything the member attendance page renders, in one composition:
 * the member's open session plus their history, with the check-in
 * actors' roles resolved ONCE for the union of both result sets.
 * (Calling getOwnOpenSession and listOwnAttendance separately — as
 * the page did before — resolved the same roles twice per render.)
 * Scoping and null semantics mirror those two functions exactly:
 * everything is keyed by the verified session context, and a context
 * whose linked Member record no longer exists yields null history.
 */
export async function getOwnAttendancePage(
  context: MemberSessionContext,
  limit = 30,
): Promise<{
  openSession: AttendanceSessionItem | null;
  history: AttendanceSessionItem[] | null;
}> {
  const member = context.member;
  if (!member) return { openSession: null, history: null };

  const scope = {
    organizationId: context.session.organizationId,
    memberId: member.id,
  };
  const [openRow, historyRows] = await Promise.all([
    db.attendanceSession.findFirst({
      where: { ...scope, checkOutAt: null },
      select: SESSION_ROW_SELECT,
    }),
    db.attendanceSession.findMany({
      where: scope,
      orderBy: { checkInAt: "desc" },
      take: Math.max(1, Math.floor(limit)),
      select: SESSION_ROW_SELECT,
    }),
  ]);
  const roleByUserId = await actorRolesByUserId(
    context.session.organizationId,
    openRow ? [...historyRows, openRow] : historyRows,
  );
  return {
    openSession: openRow ? toSessionItem(openRow, roleByUserId) : null,
    history: historyRows.map((row) => toSessionItem(row, roleByUserId)),
  };
}
