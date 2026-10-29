import "server-only";

import { Prisma, type MemberJoinRequest, type Role } from "@prisma/client";

import {
  calculateExpiryDate,
  isMembershipPlan,
  parseDateInput,
  MemberValidationError,
  validateFee,
  validateName,
  type MembershipPlan,
} from "../members";
import {
  AUDIT_EVENT_MEMBER_JOIN_REQUEST_APPROVED,
  AUDIT_EVENT_MEMBER_JOIN_REQUEST_REJECTED,
  AUDIT_EVENT_MEMBER_JOIN_REQUESTED,
  writeAuditEvent,
} from "./audit";
import { getPrimaryMembership } from "./authorization";
import {
  assertOperationsAllowed,
  assertOperationsAllowedInTransaction,
} from "./subscriptions";
import { db } from "./db";
import { LINKING_WINDOW_MS } from "./member-linking";

/**
 * Member join requests (onboarding Slice 1: submission + read-only
 * staff queue).
 *
 * A person who scanned a gym's invitation link/QR proves control of a
 * phone number through the existing OTP flow, then asks to join that
 * gym with a name and PROPOSED plan, fee, and start date. Submission:
 *
 * - creates exactly one MemberJoinRequest (status PENDING) and its
 *   MEMBER_JOIN_REQUESTED audit event, in the same transaction that
 *   consumes the verified OTP challenge;
 * - confirms nothing: no Member, no Membership, no payment, no member
 *   session, and no OrganizationMembership is created. The submitter
 *   is the phone-backed User the OTP path resolves by verified phone
 *   (the same identity linking uses) — resolving it grants nothing:
 *   no Clerk identity, no role, no membership.
 *
 * The endpoint is the sole authority on who may request. It
 * independently validates the challenge (VERIFIED, unconsumed, inside
 * the linking window, in the named organization), takes the phone
 * from the challenge row (never client input), and re-resolves the
 * existing-member candidates with the same partition member linking
 * uses. Any existing record — linkable, already linked to this user,
 * linked to another user, or duplicated — means NO request row: the
 * person is either already registered or a staff-cleanup case, and a
 * request must never become a path around either. All such context
 * failures are generic (MemberJoinRequestError), indistinguishable
 * from an unknown/expired/consumed challenge, so the endpoint cannot
 * be used to probe whether a phone is registered anywhere; the only
 * distinguishable outcomes concern the caller's own verified number
 * (already pending / already registered) or their own form input
 * (field validation).
 *
 * Duplicate safety: the partial unique index
 * member_join_requests_one_pending_per_phone (migration-only) makes a
 * second PENDING request for the same (organization, phone)
 * impossible; the in-transaction pre-check resolves the common case
 * to a friendly outcome first, and a P2002 from the index under a
 * race resolves to the same already-pending outcome. A per-phone
 * advisory lock inside the transaction serializes identity
 * resolution, so two concurrent first-time submissions for one phone
 * cannot race the user upsert either.
 */

/** Fields a join-request submission validates, with per-field messages. */
export type JoinRequestField = "name" | "plan" | "fee" | "startDate";

/** Thrown when join-request input fails validation. Carries per-field messages. */
export class MemberJoinRequestValidationError extends Error {
  fields: Partial<Record<JoinRequestField, string>>;

  constructor(fields: Partial<Record<JoinRequestField, string>>) {
    super("Join request validation failed.");
    this.name = "MemberJoinRequestValidationError";
    this.fields = fields;
  }
}

/**
 * The one generic failure for every authentication/context problem:
 * unknown, consumed, expired, non-VERIFIED, or gym-mismatched
 * challenge, and every existing-member state that must not produce a
 * request silently. The route renders one generic body for all of
 * them — they are indistinguishable by design.
 */
export class MemberJoinRequestError extends Error {
  constructor() {
    super("Join request failed.");
    this.name = "MemberJoinRequestError";
  }
}

/** Thrown when the caller lacks permission or the tenant scope fails. */
export class MemberJoinRequestAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemberJoinRequestAuthorizationError";
  }
}

/**
 * Internal control flow for the non-creating outcomes that are NOT
 * errors: the submission resolved to an existing state of the
 * caller's own (gym, phone). Thrown inside the transaction so every
 * write — including the challenge claim — rolls back; caught by
 * submitJoinRequest and returned as a result.
 */
class JoinRequestOutcome extends Error {
  constructor(
    readonly outcome: "already_registered" | "already_pending",
    readonly requestId?: string,
  ) {
    super(outcome);
    this.name = "JoinRequestOutcome";
  }
}

export type SubmitJoinRequestResult =
  | { status: "created"; requestId: string }
  | { status: "already_pending"; requestId: string }
  | { status: "already_registered" };

export interface SubmitJoinRequestInput {
  organizationId: string;
  challengeId: string;
  name: string;
  requestedPlan: string;
  /** Decimal string, e.g. "6000" or "6000.50" — the raw form value. */
  proposedFee: string;
  /** Calendar date "YYYY-MM-DD" — the raw form value. */
  proposedStartDate: string;
}

interface ValidatedJoinRequest {
  name: string;
  plan: MembershipPlan;
  feePaise: number;
  startDate: Date;
}

/**
 * Pure validation of the self-asserted form fields, reusing the
 * shared member-input validators (the same name/fee/date rules staff
 * member creation uses). Runs BEFORE any database write: a form typo
 * must never consume the person's one verified challenge, so a
 * rejected submission leaves the challenge VERIFIED and unconsumed
 * for a corrected resubmission inside its window.
 */
function validateJoinRequestInput(
  input: SubmitJoinRequestInput,
): ValidatedJoinRequest {
  const fields: Partial<Record<JoinRequestField, string>> = {};

  let name = "";
  try {
    name = validateName(input.name);
  } catch (error) {
    if (error instanceof MemberValidationError) {
      fields.name = error.errors.name;
    } else {
      throw error;
    }
  }

  let feePaise = 0;
  try {
    feePaise = validateFee(input.proposedFee);
  } catch (error) {
    if (error instanceof MemberValidationError) {
      fields.fee = error.errors.fee;
    } else {
      throw error;
    }
  }

  let plan: MembershipPlan | null = null;
  const planValue = input.requestedPlan.trim();
  if (isMembershipPlan(planValue)) {
    plan = planValue;
  } else {
    fields.plan =
      "Choose a membership plan: Monthly, 3 Months, 6 Months, or 12 Months.";
  }

  const startDate = parseDateInput(input.proposedStartDate);
  if (!startDate) {
    fields.startDate = "Start date is required. Choose a valid start date.";
  }

  if (Object.keys(fields).length > 0 || !plan || !startDate) {
    throw new MemberJoinRequestValidationError(fields);
  }
  return { name, plan, feePaise, startDate };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/**
 * The constraint identifiers a P2002 names, across the shapes Prisma
 * reports them in: `meta.target` (field or constraint names) and the
 * driver-adapter cause (`meta.driverAdapterError.cause.constraint`,
 * whose `index` names the violated index on PostgreSQL).
 */
function uniqueViolationIdentifiers(error: unknown): string[] {
  if (!isUniqueViolation(error)) return [];
  const meta = (error as Prisma.PrismaClientKnownRequestError).meta as
    | {
        target?: unknown;
        driverAdapterError?: {
          cause?: { constraint?: { index?: unknown; fields?: unknown } };
        };
      }
    | undefined;
  const identifiers: string[] = [];
  const targets = Array.isArray(meta?.target) ? meta.target : [meta?.target];
  for (const target of targets) {
    if (typeof target === "string") identifiers.push(target);
  }
  const constraint = meta?.driverAdapterError?.cause?.constraint;
  if (typeof constraint?.index === "string") {
    identifiers.push(constraint.index);
  }
  if (Array.isArray(constraint?.fields)) {
    for (const field of constraint.fields) {
      if (typeof field === "string") identifiers.push(field);
    }
  }
  return identifiers;
}

/**
 * Whether a P2002 implicates the pending-request uniqueness (the
 * partial index, or the columns it covers). Other unique violations
 * are not this outcome and must not be resolved as one.
 */
function isPendingUniquenessViolation(error: unknown): boolean {
  const identifiers = uniqueViolationIdentifiers(error);
  return identifiers.some(
    (entry) =>
      entry.includes("member_join_requests_one_pending_per_phone") ||
      (entry.includes("organization_id") && entry.includes("phone_number")),
  );
}

/** Whether a P2002 is the phone-backed user creation race. */
function isUserPhoneUniquenessViolation(error: unknown): boolean {
  return uniqueViolationIdentifiers(error).some((entry) =>
    entry.includes("users_phone_number_key"),
  );
}

/**
 * Submit a join request for the gym named by a verified OTP
 * challenge. See the module header for the outcome contract; only the
 * "created" outcome consumes the challenge.
 */
export async function submitJoinRequest(
  input: SubmitJoinRequestInput,
): Promise<SubmitJoinRequestResult> {
  const validated = validateJoinRequestInput(input);
  const { organizationId, challengeId } = input;
  // SaaS entitlement, checked BEFORE the OTP challenge is claimed: a
  // join request to a restricted gym must not consume the caller's
  // verified challenge, and staff could not act on it anyway.
  await assertOperationsAllowed(organizationId);
  const now = new Date();
  const windowStart = new Date(now.getTime() - LINKING_WINDOW_MS);
  // Set from the claimed challenge inside the transaction; the catch
  // below needs it after a rollback (the P2002 resolution path).
  let claimedPhone: string | null = null;

  try {
    const requestId = await db.$transaction(async (tx) => {
      // 1. Atomically claim the challenge — the identical conditional
      //    update member linking uses: exactly one claim flips
      //    consumedAt, and only for a VERIFIED, unconsumed challenge
      //    inside its window, in this organization. Concurrent or
      //    replayed claims update 0 rows.
      const claim = await tx.memberOtpChallenge.updateMany({
        where: {
          id: challengeId,
          organizationId,
          status: "VERIFIED",
          consumedAt: null,
          verifiedAt: { gt: windowStart },
        },
        data: { consumedAt: now },
      });
      if (claim.count !== 1) {
        throw new MemberJoinRequestError();
      }
      const challenge = await tx.memberOtpChallenge.findFirst({
        where: { id: challengeId, organizationId },
      });
      if (!challenge) {
        throw new MemberJoinRequestError();
      }
      // The phone always comes from the claimed challenge — never
      // from client input. It is already in the canonical form the
      // shared validators enforce, so the candidate lookup, the
      // stored snapshot, and the pending-uniqueness key all agree.
      const phoneNumber = challenge.phoneNumber;
      claimedPhone = phoneNumber;

      // Serialize per-phone identity resolution inside this
      // transaction: two concurrent first-time submissions for the
      // same phone (against two different challenges) would otherwise
      // race the user upsert's INSERT and one would die on the
      // users_phone_number unique index. The advisory lock is keyed
      // by the phone, held to commit, and taken at this same point
      // in every submission, so submissions for one phone linearize
      // here — the second then observes the first's committed user
      // and pending request through the ordinary reads below. (It
      // cannot deadlock: at this point the transaction holds only
      // its own challenge row, which no other submission needs.)
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${"member-join-user:" + phoneNumber}))
      `;

      // 2. Resolve/create the phone-backed User by verified phone
      //    (Option A): the create carries ONLY the phone — no name,
      //    email, Clerk identity, role, or membership — and the empty
      //    update never overwrites or detaches an existing identity.
      //    This identity exists because the audit schema requires an
      //    actor; it independently grants no authentication or
      //    authorization anywhere.
      const user = await tx.user.upsert({
        where: { phoneNumber },
        update: {},
        create: { phoneNumber },
      });

      // 3. Re-resolve existing-member candidates — the same partition
      //    member linking applies. Any existing record means NO
      //    request: linked to another user is a generic failure
      //    (staff-cleanup territory); every other existing state
      //    means this number is already registered at this gym.
      const candidates = await tx.member.findMany({
        where: { organizationId, phoneNumber },
      });
      const linkedToMe = candidates.filter((m) => m.userId === user.id);
      const linkedToOther = candidates.filter(
        (m) => m.userId !== null && m.userId !== user.id,
      );
      const unlinked = candidates.filter((m) => m.userId === null);
      if (linkedToOther.length > 0) {
        throw new MemberJoinRequestError();
      }
      // This user must not already be linked to a different Member in
      // the same gym (regardless of that record's phone).
      const existingLink = await tx.member.findFirst({
        where: { organizationId, userId: user.id },
      });
      if (linkedToMe.length > 0 || unlinked.length > 0 || existingLink) {
        throw new JoinRequestOutcome("already_registered");
      }

      // 4. Duplicate pending: resolve to the existing request. The
      //    partial unique index is the race backstop (see the catch
      //    below); this pre-check produces the outcome without
      //    relying on it in the common case.
      const pending = await tx.memberJoinRequest.findFirst({
        where: { organizationId, phoneNumber, status: "PENDING" },
        select: { id: true },
      });
      if (pending) {
        throw new JoinRequestOutcome("already_pending", pending.id);
      }

      // 5. Create the request and its audit event — the only writes
      //    this flow ever makes, atomic with the challenge claim.
      const request = await tx.memberJoinRequest.create({
        data: {
          organizationId,
          userId: user.id,
          phoneNumber,
          name: validated.name,
          requestedPlan: validated.plan,
          // Exact Decimal from integer paise — no floating point.
          proposedFee: new Prisma.Decimal(validated.feePaise).div(100),
          proposedStartDate: validated.startDate,
          status: "PENDING",
        },
        select: { id: true },
      });
      await writeAuditEvent(tx, {
        organizationId,
        actorUserId: user.id,
        event: AUDIT_EVENT_MEMBER_JOIN_REQUESTED,
        targetType: "MemberJoinRequest",
        targetId: request.id,
        metadata: { challengeId },
      });
      return request.id;
    });
    return { status: "created", requestId };
  } catch (error) {
    if (error instanceof JoinRequestOutcome) {
      if (error.outcome === "already_pending" && error.requestId) {
        return { status: "already_pending", requestId: error.requestId };
      }
      return { status: "already_registered" };
    }
    if (error instanceof MemberJoinRequestError) throw error;
    if (
      (isPendingUniquenessViolation(error) ||
        isUserPhoneUniquenessViolation(error)) &&
      claimedPhone !== null
    ) {
      // A uniqueness race was lost despite the pre-checks: the
      // partial pending index fired under a true race, or the
      // phone-backed user was created concurrently by the linking
      // flow (which does not take this service's advisory lock). If
      // the winner's pending request for the caller's own
      // organization and verified phone now exists, it is the
      // outcome; the re-read is scoped to exactly that pair, so
      // nothing about another tenant can surface.
      const existing = await db.memberJoinRequest.findFirst({
        where: { organizationId, phoneNumber: claimedPhone, status: "PENDING" },
        select: { id: true },
      });
      if (existing) {
        return { status: "already_pending", requestId: existing.id };
      }
      if (isUserPhoneUniquenessViolation(error)) {
        // Lost the cross-flow user race and no request exists: the
        // challenge rolled back unconsumed, so the generic failure
        // (retry with a fresh code) is the honest outcome — the same
        // treatment linking gives this race.
        throw new MemberJoinRequestError();
      }
    }
    throw error;
  }
}

/** Roles allowed to view the pending-members queue. */
export function canViewJoinRequests(role: Role): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "STAFF";
}

export interface MemberJoinRequestView {
  id: string;
  name: string;
  phoneNumber: string;
  requestedPlan: MembershipPlan;
  /** What the requester proposed, in paise. Never a balance input. */
  proposedFeePaise: number;
  proposedStartDate: string;
  submittedAt: string;
}

function toJoinRequestView(row: MemberJoinRequest): MemberJoinRequestView {
  return {
    id: row.id,
    name: row.name,
    phoneNumber: row.phoneNumber,
    requestedPlan: row.requestedPlan,
    proposedFeePaise: row.proposedFee.mul(100).toNumber(),
    proposedStartDate: row.proposedStartDate.toISOString(),
    submittedAt: row.createdAt.toISOString(),
  };
}

interface StaffScope {
  userId: string;
  organizationId: string;
  role: Role;
}

/** Staff scope from the actor's own primary membership (never input). */
async function resolveStaffScope(userId: string): Promise<StaffScope> {
  if (!userId) {
    throw new MemberJoinRequestAuthorizationError(
      "Authentication is required.",
    );
  }
  const membership = await getPrimaryMembership(userId);
  if (!membership) {
    throw new MemberJoinRequestAuthorizationError(
      "You do not belong to an organization.",
    );
  }
  return {
    userId,
    organizationId: membership.organizationId,
    role: membership.role,
  };
}

/** Maximum requests the queue returns at once (oldest first). */
export const MAX_QUEUE_REQUESTS = 100;

/**
 * The gym's pending join requests, oldest first — the read-only
 * Pending Members queue. Authorization and scope mirror the payment
 * claims queue: the organization comes from the actor's own primary
 * membership, never from input, and only OWNER / ADMIN / STAFF may
 * view it (the queue exposes phone numbers of people who are not yet
 * members; TRAINER's limited member view has never included prospect
 * data). Returns the total pending count alongside the capped list
 * so the page can say when it is showing a prefix.
 */
export async function listPendingJoinRequests(
  staffUserId: string,
): Promise<{ requests: MemberJoinRequestView[]; totalPending: number }> {
  const scope = await resolveStaffScope(staffUserId);
  if (!canViewJoinRequests(scope.role)) {
    throw new MemberJoinRequestAuthorizationError(
      "You do not have permission to view join requests.",
    );
  }
  const where = { organizationId: scope.organizationId, status: "PENDING" as const };
  const [rows, totalPending] = await Promise.all([
    db.memberJoinRequest.findMany({
      where,
      orderBy: { createdAt: "asc" },
      take: MAX_QUEUE_REQUESTS,
    }),
    db.memberJoinRequest.count({ where }),
  ]);
  return { requests: rows.map(toJoinRequestView), totalPending };
}

// ---------------------------------------------------------------------------
// Decisions (Slice 2): approve / reject a pending join request.
// ---------------------------------------------------------------------------

/**
 * Staff decisions on join requests.
 *
 * A decision is ONE transaction, so it either lands completely —
 * request transitioned, member/membership side effects, decision
 * audit — or not at all:
 *
 * - The decider's authority is revalidated INSIDE the transaction
 *   under a lock on their organization-membership row in the
 *   request's gym (the payment-claims revalidate pattern): the
 *   organization always comes from the request row itself, a decider
 *   with no membership in that gym gets the same not-found outcome
 *   as a nonexistent request (no tenant oracle), and only OWNER /
 *   ADMIN / STAFF may decide — a demotion or removal that commits
 *   first is seen by the locked read and denies the decision.
 * - A per-(gym, phone) advisory lock, taken after the actor lock in
 *   every decision and in staff member creation, serializes the
 *   decision against other decisions for the same phone and against
 *   createMemberWithMembership: the candidate scan below therefore
 *   observes a stable member set for the phone and linearizes with
 *   staff creating that member by hand.
 * - The PENDING → decided transition is a conditional update that
 *   only matches a still-PENDING row: two staff racing to decide
 *   cannot both win, and the loser creates nothing.
 *
 * Approval resolves the member with the same partition member
 * linking applies — never overwriting another user's link, never
 * merging duplicate records — creates the member's FIRST membership
 * from the staff-confirmed terms (expiry derived, exactly as staff
 * member creation derives it), and records which member resulted.
 * Approval is not a payment: it creates no Payment and no claim,
 * and the new membership's fee is simply outstanding. Any existing
 * Membership row blocks approval outright: stacking a second period
 * onto a member who already has one is a staff decision for the
 * member surfaces, not a side effect of a queue click.
 */

/** Thrown when the request cannot be found in the decider's reach. */
export class MemberJoinRequestNotFoundError extends Error {
  constructor(message = "Join request not found.") {
    super(message);
    this.name = "MemberJoinRequestNotFoundError";
  }
}

/** Thrown when the request has already been decided (decision race). */
export class MemberJoinRequestAlreadyDecidedError extends Error {
  constructor(message = "This join request has already been decided.") {
    super(message);
    this.name = "MemberJoinRequestAlreadyDecidedError";
  }
}

/** Why an approval cannot proceed against the current member records. */
export type JoinRequestDecisionConflictReason =
  | "member_linked_elsewhere"
  | "duplicate_member_records"
  | "member_has_membership";

const DECISION_CONFLICT_MESSAGES: Record<
  JoinRequestDecisionConflictReason,
  string
> = {
  member_linked_elsewhere:
    "This phone number belongs to a member record linked to a different account.",
  duplicate_member_records:
    "More than one unlinked member record exists for this phone number.",
  member_has_membership:
    "The member already has a membership, so approval cannot create another one.",
};

/**
 * Thrown when approval would have to overwrite a link, merge
 * duplicates, or stack a second membership. The request stays
 * PENDING (the whole transaction rolls back) for staff to resolve
 * through the member surfaces first.
 */
export class MemberJoinRequestDecisionConflictError extends Error {
  readonly reason: JoinRequestDecisionConflictReason;

  constructor(reason: JoinRequestDecisionConflictReason) {
    super(DECISION_CONFLICT_MESSAGES[reason]);
    this.name = "MemberJoinRequestDecisionConflictError";
    this.reason = reason;
  }
}

/**
 * Roles allowed to decide join requests: the same OWNER / ADMIN /
 * STAFF set that may view the queue (TRAINER never sees prospect
 * phone numbers, so TRAINER never decides on them either).
 */
export function canDecideJoinRequests(role: Role): boolean {
  return canViewJoinRequests(role);
}

/** The staff-confirmed membership terms, as submitted by the form. */
export interface ApproveJoinRequestTerms {
  plan: string;
  /** Decimal string, e.g. "6000" or "6000.50" — the raw form value. */
  fee: string;
  /** Calendar date "YYYY-MM-DD" — the raw form value. */
  startDate: string;
}

interface ValidatedDecisionTerms {
  plan: MembershipPlan;
  feePaise: number;
  startDate: Date;
}

/**
 * Pure validation of the staff-confirmed terms, reusing the shared
 * member-input validators (the exact fee/plan/date rules submission
 * and staff member creation use). Runs BEFORE the decision
 * transaction: a typo'd term must fail as a field error, never as a
 * half-decided request.
 */
function validateDecisionTerms(
  terms: ApproveJoinRequestTerms,
): ValidatedDecisionTerms {
  const fields: Partial<Record<JoinRequestField, string>> = {};

  let feePaise = 0;
  try {
    feePaise = validateFee(terms.fee);
  } catch (error) {
    if (error instanceof MemberValidationError) {
      fields.fee = error.errors.fee;
    } else {
      throw error;
    }
  }

  let plan: MembershipPlan | null = null;
  const planValue = terms.plan.trim();
  if (isMembershipPlan(planValue)) {
    plan = planValue;
  } else {
    fields.plan =
      "Choose a membership plan: Monthly, 3 Months, 6 Months, or 12 Months.";
  }

  const startDate = parseDateInput(terms.startDate);
  if (!startDate) {
    fields.startDate = "Start date is required. Choose a valid start date.";
  }

  if (Object.keys(fields).length > 0 || !plan || !startDate) {
    throw new MemberJoinRequestValidationError(fields);
  }
  return { plan, feePaise, startDate };
}

/**
 * The decision lock shared with staff member creation: one advisory
 * lock per (gym, phone) linearizes join-request decisions against
 * each other and against createMemberWithMembership for the same
 * phone (see members.ts). Distinct from submission's
 * "member-join-user:" lock — submissions create no members, so they
 * are not part of this lock domain.
 */
async function lockDecisionPhone(
  tx: Prisma.TransactionClient,
  organizationId: string,
  phoneNumber: string,
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${"member-decision:" + organizationId + ":" + phoneNumber}))
  `;
}

interface LockedDeciderRow {
  role: Role;
}

/**
 * Re-derive the decider's authority inside the decision transaction,
 * under a lock on their membership row IN THE REQUEST'S GYM (the
 * payment-claims revalidateVerifierInTransaction pattern, scoped to
 * the organization the request belongs to). The locked row
 * serializes against the role change/removal itself, so the two
 * linearize: a revocation that committed first is observed and
 * denies; one still in flight waits and then applies to a state
 * where the decision is already final. No row in this gym is the
 * not-found outcome — a decider from another tenant must not learn
 * that the request exists.
 */
async function revalidateDeciderInTransaction(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  organizationId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<LockedDeciderRow[]>`
    SELECT role
    FROM organization_memberships
    WHERE user_id = ${actorUserId}
      AND organization_id = ${organizationId}
    FOR UPDATE
  `;
  const current = rows[0];
  if (!current) {
    throw new MemberJoinRequestNotFoundError();
  }
  if (!canDecideJoinRequests(current.role)) {
    throw new MemberJoinRequestAuthorizationError(
      "You do not have permission to decide join requests.",
    );
  }
}

interface DecisionRequestRow {
  id: string;
  organizationId: string;
  userId: string;
  phoneNumber: string;
  name: string;
}

/**
 * Load the request being decided. The row is loaded by ID alone
 * because it is the authority on its own organization — the
 * decider's membership is then checked against THAT organization
 * under lock, which is what pins the tenant: an ID from another gym
 * resolves only for a user who is staff of that gym.
 */
async function loadRequestForDecision(
  tx: Prisma.TransactionClient,
  requestId: string,
): Promise<DecisionRequestRow> {
  const request = await tx.memberJoinRequest.findFirst({
    where: { id: requestId },
    select: {
      id: true,
      organizationId: true,
      userId: true,
      phoneNumber: true,
      name: true,
    },
  });
  if (!request) {
    throw new MemberJoinRequestNotFoundError();
  }
  return request;
}

export interface ApproveJoinRequestResult {
  requestId: string;
  memberId: string;
  membershipId: string;
  /** True when approval adopted the pre-existing unlinked record. */
  adoptedExistingMember: boolean;
}

/**
 * Approve a pending join request: the requester becomes a member of
 * the gym, linked to their phone-backed User, with a first
 * membership on the staff-confirmed terms. See the section header
 * for the transactional contract; every failure after the transition
 * rolls the whole decision back, leaving the request PENDING.
 */
export async function approveJoinRequest(
  actorUserId: string,
  requestId: string,
  terms: ApproveJoinRequestTerms,
): Promise<ApproveJoinRequestResult> {
  if (!actorUserId) {
    throw new MemberJoinRequestAuthorizationError(
      "Authentication is required.",
    );
  }
  const validated = validateDecisionTerms(terms);
  const now = new Date();

  try {
    return await db.$transaction(async (tx) => {
      const request = await loadRequestForDecision(tx, requestId);
      const { organizationId } = request;
      await assertOperationsAllowedInTransaction(tx, organizationId);

      // 1. Revalidate the decider under lock before any mutation.
      await revalidateDeciderInTransaction(tx, actorUserId, organizationId);

      // 2. Serialize against other decisions and staff member
      //    creation for this (gym, phone).
      await lockDecisionPhone(tx, organizationId, request.phoneNumber);

      // 3. Claim the decision atomically: only a still-PENDING
      //    request transitions, so racing deciders cannot both win.
      //    (The request row was just loaded inside this transaction,
      //    so a zero count can only mean it is no longer PENDING.)
      const transition = await tx.memberJoinRequest.updateMany({
        where: { id: request.id, organizationId, status: "PENDING" },
        data: {
          status: "APPROVED",
          decidedByUserId: actorUserId,
          decidedAt: now,
        },
      });
      if (transition.count !== 1) {
        throw new MemberJoinRequestAlreadyDecidedError();
      }

      // 4. Resolve the member — the same partition member linking
      //    applies. Approval never overwrites a link and never
      //    merges duplicate records.
      const candidates = await tx.member.findMany({
        where: { organizationId, phoneNumber: request.phoneNumber },
      });
      const linkedToRequester = candidates.filter(
        (m) => m.userId === request.userId,
      );
      const linkedToOther = candidates.filter(
        (m) => m.userId !== null && m.userId !== request.userId,
      );
      const unlinked = candidates.filter((m) => m.userId === null);
      if (linkedToOther.length > 0) {
        throw new MemberJoinRequestDecisionConflictError(
          "member_linked_elsewhere",
        );
      }

      let member = linkedToRequester[0] ?? null;
      let adoptedExistingMember = false;
      if (!member) {
        // The requester must not already be linked to a different
        // Member in this gym (under another phone): adopting or
        // creating here would split one person across two records.
        const existingLink = await tx.member.findFirst({
          where: { organizationId, userId: request.userId },
          select: { id: true },
        });
        if (existingLink) {
          throw new MemberJoinRequestDecisionConflictError(
            "member_linked_elsewhere",
          );
        }
        if (unlinked.length > 1) {
          throw new MemberJoinRequestDecisionConflictError(
            "duplicate_member_records",
          );
        }
        const candidate = unlinked[0];
        if (candidate) {
          // Adopt the staff-created record as-is (D4): only the link
          // is set; its name/phone stay exactly as staff recorded
          // them.
          member = await tx.member.update({
            where: { id: candidate.id },
            data: { userId: request.userId },
          });
          adoptedExistingMember = true;
        }
      }
      if (!member) {
        member = await tx.member.create({
          data: {
            organizationId,
            name: request.name,
            phoneNumber: request.phoneNumber,
            userId: request.userId,
          },
        });
      }

      // 5. D2 guard: approval creates the member's FIRST membership
      //    only. Any existing period — however it got there — blocks
      //    the decision rather than being stacked over.
      const existingMemberships = await tx.membership.count({
        where: { organizationId, memberId: member.id },
      });
      if (existingMemberships > 0) {
        throw new MemberJoinRequestDecisionConflictError(
          "member_has_membership",
        );
      }

      // 6. The initial membership on the confirmed terms. Expiry is
      //    derived by calculateExpiryDate — the same rule staff
      //    member creation applies; there is no staff-typed expiry.
      const expiryDate = calculateExpiryDate(
        validated.startDate,
        validated.plan,
      );
      const membership = await tx.membership.create({
        data: {
          organizationId,
          memberId: member.id,
          plan: validated.plan,
          startDate: validated.startDate,
          expiryDate,
          // Exact Decimal from integer paise — no floating point.
          fee: new Prisma.Decimal(validated.feePaise).div(100),
        },
        select: { id: true },
      });

      // 7. Record which member the request produced (the link the
      //    RESTRICT foreign key protects) and audit the decision —
      //    all inside this transaction.
      await tx.memberJoinRequest.update({
        where: { id: request.id },
        data: { resultingMemberId: member.id },
      });
      await writeAuditEvent(tx, {
        organizationId,
        actorUserId,
        event: AUDIT_EVENT_MEMBER_JOIN_REQUEST_APPROVED,
        targetType: "MemberJoinRequest",
        targetId: request.id,
        metadata: {
          joinRequestId: request.id,
          memberId: member.id,
          membershipId: membership.id,
          plan: validated.plan,
          feePaise: validated.feePaise,
          startDate: validated.startDate.toISOString(),
          expiryDate: expiryDate.toISOString(),
          adoptedExistingMember,
        },
      });

      return {
        requestId: request.id,
        memberId: member.id,
        membershipId: membership.id,
        adoptedExistingMember,
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // The members (organization_id, user_id) partial unique index
      // fired: between the candidate scan and the write, a
      // concurrent link attached the requester's account to another
      // record in this gym. That is the linked-elsewhere conflict,
      // not a server fault.
      throw new MemberJoinRequestDecisionConflictError(
        "member_linked_elsewhere",
      );
    }
    throw error;
  }
}

/**
 * Reject a pending join request: it closes with the decider and the
 * decision time recorded, and nothing else is created — no member,
 * no membership, no payment.
 */
export async function rejectJoinRequest(
  actorUserId: string,
  requestId: string,
): Promise<{ requestId: string }> {
  if (!actorUserId) {
    throw new MemberJoinRequestAuthorizationError(
      "Authentication is required.",
    );
  }
  const now = new Date();

  await db.$transaction(async (tx) => {
    const request = await loadRequestForDecision(tx, requestId);
    const { organizationId } = request;
    await assertOperationsAllowedInTransaction(tx, organizationId);

    // Same revalidation and lock order as approval, so the two
    // decisions linearize against each other.
    await revalidateDeciderInTransaction(tx, actorUserId, organizationId);
    await lockDecisionPhone(tx, organizationId, request.phoneNumber);

    const transition = await tx.memberJoinRequest.updateMany({
      where: { id: request.id, organizationId, status: "PENDING" },
      data: {
        status: "REJECTED",
        decidedByUserId: actorUserId,
        decidedAt: now,
      },
    });
    if (transition.count !== 1) {
      throw new MemberJoinRequestAlreadyDecidedError();
    }
    await writeAuditEvent(tx, {
      organizationId,
      actorUserId,
      event: AUDIT_EVENT_MEMBER_JOIN_REQUEST_REJECTED,
      targetType: "MemberJoinRequest",
      targetId: request.id,
      metadata: { joinRequestId: request.id },
    });
  });
  return { requestId };
}
