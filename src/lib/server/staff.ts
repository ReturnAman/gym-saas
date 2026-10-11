import "server-only";

import { Prisma, type OrganizationMembership, type Role } from "@prisma/client";

import {
  AUDIT_EVENT_STAFF_ACCESS_REVOKED,
  AUDIT_EVENT_STAFF_ADDED,
  AUDIT_EVENT_STAFF_ROLE_CHANGED,
  writeAuditEvent,
} from "./audit";
import { getPrimaryMembership } from "./authorization";
import {
  ClerkDirectoryUnavailableError,
  findClerkUserByVerifiedEmail,
} from "./clerk-directory";
import { db } from "./db";

/**
 * Staff management (Staff Management V1, S1 — service layer).
 *
 * An OWNER or ADMIN manages who holds staff roles in their gym by
 * assigning roles to accounts that ALREADY exist: the person must have
 * signed in through Clerk and been synchronized to a local User row
 * (auth.ts). This service never creates accounts or User rows, never
 * sends invitations, and never assigns OWNER.
 *
 * Security model:
 * - The acting user's organization is derived from their own membership
 *   (resolveScope). No function accepts an organization ID, so a user
 *   from Gym A cannot name Gym B.
 *
 *   SCOPE LIMITATION (explicit, follow-up required): scope resolution
 *   uses the actor's PRIMARY membership — their earliest gym — which is
 *   the same resolution requireOrganizationContext() gives every staff
 *   page, so this service and the UI can never disagree about which gym
 *   is being managed. A manager who belongs to several gyms cannot yet
 *   choose a different one here; explicit organization selection (a gym
 *   switcher) is the follow-up that lifts this limitation, and until it
 *   exists the staff UI must display the resolved organization's name
 *   (available from the page's organization context) so the operator can
 *   see which gym they are managing.
 * - Account lookup resolves an email through Clerk (clerk-directory.ts),
 *   which requires an EXACT match on a VERIFIED address owned by exactly
 *   one account, then resolves the local User by clerkUserId. A missing
 *   account, an unverifiable email, or a missing local User all fail with
 *   the same sign-in-first error — nothing is created or merged.
 * - The authorization matrix (getStaffPermissions) is enforced in this
 *   layer on every operation; UI state is never trusted.
 * - OWNER memberships are structurally untouchable here: OWNER is not an
 *   assignable role, and change/revoke reject OWNER targets, so no staff
 *   operation can create, demote, or remove an owner — the at-least-one-
 *   OWNER invariant does not depend on counting owners under concurrency.
 *   Role changes and revocations additionally write conditionally on the
 *   target's observed role inside the transaction, so a concurrent
 *   mutation invalidates the write instead of being overwritten blindly.
 * - Duplicate memberships are impossible: the (user_id, organization_id)
 *   unique constraint settles concurrent adds, and its P2002 is
 *   translated to a conflict error.
 * - Actor authority is REVALIDATED at the mutation boundary: every
 *   mutation transaction first locks the actor's own primary membership
 *   row (SELECT ... FOR UPDATE) and re-derives their permissions from
 *   the locked row. A concurrent revocation or downgrade of the actor
 *   therefore serializes against the mutation — it either commits first
 *   (and the request is denied on the fresh state) or waits for the
 *   mutation to finish (the request completed while still authorized).
 *   The Clerk account lookup happens BEFORE the transaction opens, so no
 *   database lock is ever held during a network call. (As with the
 *   target writes, two operations that mutually target each other's
 *   actor row can deadlock; PostgreSQL aborts one, which writes
 *   nothing and is safe to retry.)
 * - Successful mutations and their audit events commit in ONE
 *   transaction; rejected operations write nothing (ADR 017).
 */

export { ClerkDirectoryUnavailableError };

/** Shown when an email cannot be resolved to a registered account. */
export const STAFF_SIGN_IN_FIRST_MESSAGE =
  "No registered account was found for that email. Ask the person to sign in first, then try again.";

/** Thrown when the caller lacks permission or the tenant scope fails. */
export class StaffAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaffAuthorizationError";
  }
}

/** Thrown when the target staff membership is not in the caller's gym. */
export class StaffNotFoundError extends Error {
  constructor(message = "Staff member not found.") {
    super(message);
    this.name = "StaffNotFoundError";
  }
}

/** Thrown when the person already has access, or state raced a mutation. */
export class StaffConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaffConflictError";
  }
}

/** Thrown for malformed input (email shape, unassignable role value). */
export class StaffValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaffValidationError";
  }
}

/**
 * Thrown when an email does not resolve to an existing, verified,
 * locally-synchronized account. The message is deliberately identical
 * for "no Clerk account", "email not verified", and "no local User".
 */
export class StaffAccountNotFoundError extends Error {
  constructor(message = STAFF_SIGN_IN_FIRST_MESSAGE) {
    super(message);
    this.name = "StaffAccountNotFoundError";
  }
}

/** Roles this feature may ever assign. OWNER is never assignable. */
const ASSIGNABLE_ROLES: readonly Role[] = ["ADMIN", "STAFF", "TRAINER"];

export interface StaffPermissions {
  canViewStaff: boolean;
  canManageStaff: boolean;
  /** Roles the actor may grant when adding or changing a staff member. */
  grantableRoles: Role[];
  /** Current roles of target memberships the actor may change or revoke. */
  manageableRoles: Role[];
}

export function getStaffPermissions(role: Role): StaffPermissions {
  switch (role) {
    case "OWNER":
      return {
        canViewStaff: true,
        canManageStaff: true,
        grantableRoles: ["ADMIN", "STAFF", "TRAINER"],
        manageableRoles: ["ADMIN", "STAFF", "TRAINER"],
      };
    case "ADMIN":
      return {
        canViewStaff: true,
        canManageStaff: true,
        grantableRoles: ["STAFF", "TRAINER"],
        manageableRoles: ["STAFF", "TRAINER"],
      };
    default:
      return {
        canViewStaff: false,
        canManageStaff: false,
        grantableRoles: [],
        manageableRoles: [],
      };
  }
}

/** Roles allowed to manage staff in V1. */
export function canManageStaff(role: Role): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Email normalization per repository convention: trim, then lowercase. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface StaffScope {
  userId: string;
  organizationId: string;
  role: Role;
}

/**
 * Resolve the caller's tenant scope from their own organization membership.
 * The organization ID is never accepted from the caller. This resolves the
 * actor's PRIMARY (earliest) membership — see the scope limitation in the
 * module header.
 */
async function resolveScope(userId: string): Promise<StaffScope> {
  if (!userId) {
    throw new StaffAuthorizationError("Authentication is required.");
  }
  const membership = await getPrimaryMembership(userId);
  if (!membership) {
    throw new StaffAuthorizationError("You do not belong to an organization.");
  }
  return {
    userId,
    organizationId: membership.organizationId,
    role: membership.role,
  };
}

function requireManager(scope: StaffScope): StaffPermissions {
  const permissions = getStaffPermissions(scope.role);
  if (!permissions.canManageStaff) {
    throw new StaffAuthorizationError(
      "You do not have permission to manage staff.",
    );
  }
  return permissions;
}

interface LockedActorMembership {
  id: string;
  organizationId: string;
  role: Role;
}

/**
 * Revalidate the actor's authority at the mutation boundary, INSIDE the
 * transaction that is about to write. The actor's primary membership
 * row — the same earliest-membership resolution as resolveScope — is
 * read with SELECT ... FOR UPDATE and locked for the rest of the
 * transaction:
 *
 * - If a concurrent transaction revoked or superseded that membership
 *   and committed first, the locked read sees the fresh state: no row,
 *   or a different primary organization, and the request is denied.
 * - If the concurrent revocation is still in flight, it cannot commit
 *   its delete/update of this row until this transaction finishes, so
 *   this mutation provably completes while the actor is still
 *   authorized — a well-defined serial ordering either way.
 *
 * Permissions are re-derived from the LOCKED row's role, never from the
 * pre-transaction scope, and the returned permissions are what the
 * mutation's remaining checks must use. Runs no network calls: the
 * Clerk lookup stays outside the transaction.
 */
async function revalidateActorInTransaction(
  tx: Prisma.TransactionClient,
  scope: StaffScope,
): Promise<StaffPermissions> {
  const rows = await tx.$queryRaw<LockedActorMembership[]>`
    SELECT id, organization_id AS "organizationId", role
    FROM organization_memberships
    WHERE user_id = ${scope.userId}
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE
  `;
  const current = rows[0];
  if (!current || current.organizationId !== scope.organizationId) {
    throw new StaffAuthorizationError(
      "Your staff access changed while you were working. Refresh and try again.",
    );
  }
  const permissions = getStaffPermissions(current.role);
  if (!permissions.canManageStaff) {
    throw new StaffAuthorizationError(
      "You do not have permission to manage staff.",
    );
  }
  return permissions;
}

function validateAssignableRole(
  role: Role,
  permissions: StaffPermissions,
): void {
  if (!ASSIGNABLE_ROLES.includes(role)) {
    throw new StaffValidationError("That role cannot be assigned.");
  }
  if (!permissions.grantableRoles.includes(role)) {
    throw new StaffAuthorizationError("You cannot grant that role.");
  }
}

interface StaffCandidate {
  userId: string;
  email: string;
  displayName: string | null;
}

/**
 * Resolve an email to an existing local User through Clerk. Throws
 * StaffAccountNotFoundError (sign-in-first) for every unresolvable case;
 * ClerkDirectoryUnavailableError propagates for provider failures.
 */
async function resolveCandidate(rawEmail: string): Promise<StaffCandidate> {
  const email = normalizeEmail(rawEmail);
  if (!EMAIL_PATTERN.test(email)) {
    throw new StaffValidationError("Enter a valid email address.");
  }
  const directoryUser = await findClerkUserByVerifiedEmail(email);
  if (!directoryUser) {
    throw new StaffAccountNotFoundError();
  }
  const user = await db.user.findUnique({
    where: { clerkUserId: directoryUser.clerkUserId },
    select: { id: true },
  });
  if (!user) {
    throw new StaffAccountNotFoundError();
  }
  return { userId: user.id, email, displayName: directoryUser.displayName };
}

export interface StaffListEntry {
  id: string;
  userId: string;
  role: Role;
  createdAt: Date;
}

/** Roles that count as staff for listing. MEMBER rows are gym members,
 * not staff, and are always excluded. */
const STAFF_LIST_ROLES: readonly Role[] = [
  "OWNER",
  "ADMIN",
  "STAFF",
  "TRAINER",
];

/**
 * List the staff memberships of the caller's gym (OWNER/ADMIN only).
 * Scoped to the caller's organization and to staff roles only — plain
 * MEMBER memberships (gym members who signed in) are never listed.
 */
export async function listOrganizationStaff(
  userId: string,
): Promise<StaffListEntry[]> {
  const scope = await resolveScope(userId);
  if (!getStaffPermissions(scope.role).canViewStaff) {
    throw new StaffAuthorizationError(
      "You do not have permission to view staff.",
    );
  }
  const rows = await db.organizationMembership.findMany({
    where: {
      organizationId: scope.organizationId,
      role: { in: [...STAFF_LIST_ROLES] },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      userId: true,
      role: true,
      createdAt: true,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    role: row.role,
    createdAt: row.createdAt,
  }));
}

export interface StaffCandidateResult {
  /** Normalized email the lookup was performed for. */
  email: string;
  /** Display name from the account directory, when the account has one. */
  displayName: string | null;
  /** The candidate's current role in the caller's gym, if any. */
  existingRole: Role | null;
}

/**
 * Look up an existing account by email for the add-staff flow. Returns the
 * minimum needed to confirm the right person; exposes no other gyms, roles
 * elsewhere, or account data.
 */
export async function findStaffCandidateByEmail(
  userId: string,
  rawEmail: string,
): Promise<StaffCandidateResult> {
  const scope = await resolveScope(userId);
  requireManager(scope);
  const candidate = await resolveCandidate(rawEmail);
  const existing = await db.organizationMembership.findUnique({
    where: {
      userId_organizationId: {
        userId: candidate.userId,
        organizationId: scope.organizationId,
      },
    },
    select: { role: true },
  });
  // Deliberately a hand-picked shape, NOT a spread of the internal
  // candidate: the internal record carries the local userId (and the
  // Clerk ID) for server-side membership operations, and neither may
  // leak into the public lookup result — the add operation re-resolves
  // the account from the email on the server at mutation time.
  return {
    email: candidate.email,
    displayName: candidate.displayName,
    existingRole: existing?.role ?? null,
  };
}

export interface AddStaffInput {
  email: string;
  role: Role;
}

/**
 * Add an existing account to the caller's gym with an allowed role. The
 * account is re-resolved server-side from the email at mutation time —
 * a client-supplied user ID is never accepted.
 */
export async function addOrganizationStaff(
  userId: string,
  input: AddStaffInput,
): Promise<OrganizationMembership> {
  const scope = await resolveScope(userId);
  const permissions = requireManager(scope);
  validateAssignableRole(input.role, permissions);
  const candidate = await resolveCandidate(input.email);
  if (candidate.userId === scope.userId) {
    throw new StaffAuthorizationError(
      "You cannot change your own staff access.",
    );
  }
  try {
    return await db.$transaction(async (tx) => {
      const freshPermissions = await revalidateActorInTransaction(tx, scope);
      validateAssignableRole(input.role, freshPermissions);
      const created = await tx.organizationMembership.create({
        data: {
          userId: candidate.userId,
          organizationId: scope.organizationId,
          role: input.role,
        },
      });
      await writeAuditEvent(tx, {
        organizationId: scope.organizationId,
        actorUserId: scope.userId,
        event: AUDIT_EVENT_STAFF_ADDED,
        targetType: "OrganizationMembership",
        targetId: created.id,
        metadata: { targetUserId: candidate.userId, role: input.role },
      });
      return created;
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new StaffConflictError(
        "That person already has access to this gym.",
      );
    }
    throw error;
  }
}

export interface ChangeStaffRoleInput {
  membershipId: string;
  role: Role;
}

/**
 * Change a staff member's role. The write is conditional on the target's
 * observed role inside the transaction, so a concurrent change or
 * revocation invalidates it (conflict) instead of being overwritten.
 * Re-requesting the current role is a no-op: no write, no audit event.
 */
export async function changeOrganizationStaffRole(
  userId: string,
  input: ChangeStaffRoleInput,
): Promise<OrganizationMembership> {
  const scope = await resolveScope(userId);
  const permissions = requireManager(scope);
  validateAssignableRole(input.role, permissions);
  return db.$transaction(async (tx) => {
    const freshPermissions = await revalidateActorInTransaction(tx, scope);
    validateAssignableRole(input.role, freshPermissions);
    const target = await tx.organizationMembership.findFirst({
      where: { id: input.membershipId, organizationId: scope.organizationId },
    });
    if (!target) {
      throw new StaffNotFoundError();
    }
    assertCanManageTarget(scope, freshPermissions, target);
    if (target.role === input.role) {
      return target;
    }
    const updated = await tx.organizationMembership.updateMany({
      where: {
        id: target.id,
        organizationId: scope.organizationId,
        role: target.role,
      },
      data: { role: input.role },
    });
    if (updated.count !== 1) {
      throw new StaffConflictError(
        "This staff access changed while you were working. Refresh and try again.",
      );
    }
    await writeAuditEvent(tx, {
      organizationId: scope.organizationId,
      actorUserId: scope.userId,
      event: AUDIT_EVENT_STAFF_ROLE_CHANGED,
      targetType: "OrganizationMembership",
      targetId: target.id,
      metadata: {
        targetUserId: target.userId,
        fromRole: target.role,
        toRole: input.role,
      },
    });
    return { ...target, role: input.role };
  });
}

export interface RevokeStaffAccessInput {
  membershipId: string;
}

/**
 * Revoke a staff member's access to the caller's gym. Deletes ONLY the
 * organization membership row: the global User and their memberships in
 * other gyms are untouched.
 */
export async function revokeOrganizationStaffAccess(
  userId: string,
  input: RevokeStaffAccessInput,
): Promise<OrganizationMembership> {
  const scope = await resolveScope(userId);
  requireManager(scope);
  return db.$transaction(async (tx) => {
    const freshPermissions = await revalidateActorInTransaction(tx, scope);
    const target = await tx.organizationMembership.findFirst({
      where: { id: input.membershipId, organizationId: scope.organizationId },
    });
    if (!target) {
      throw new StaffNotFoundError();
    }
    assertCanManageTarget(scope, freshPermissions, target);
    const deleted = await tx.organizationMembership.deleteMany({
      where: {
        id: target.id,
        organizationId: scope.organizationId,
        role: target.role,
      },
    });
    if (deleted.count !== 1) {
      throw new StaffConflictError(
        "This staff access changed while you were working. Refresh and try again.",
      );
    }
    await writeAuditEvent(tx, {
      organizationId: scope.organizationId,
      actorUserId: scope.userId,
      event: AUDIT_EVENT_STAFF_ACCESS_REVOKED,
      targetType: "OrganizationMembership",
      targetId: target.id,
      metadata: { targetUserId: target.userId, role: target.role },
    });
    return target;
  });
}

/**
 * Shared target checks for change/revoke: never self, never an OWNER,
 * and the target's current role must be within the actor's manageable set
 * (this is what stops an ADMIN from altering another ADMIN).
 */
function assertCanManageTarget(
  scope: StaffScope,
  permissions: StaffPermissions,
  target: OrganizationMembership,
): void {
  if (target.userId === scope.userId) {
    throw new StaffAuthorizationError(
      "You cannot change your own staff access.",
    );
  }
  if (target.role === "OWNER") {
    throw new StaffAuthorizationError(
      "The gym owner's access cannot be changed here.",
    );
  }
  if (!permissions.manageableRoles.includes(target.role)) {
    throw new StaffAuthorizationError(
      "You cannot change this staff member's access.",
    );
  }
}
