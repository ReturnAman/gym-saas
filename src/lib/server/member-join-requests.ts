import "server-only";

import { Prisma, type MemberJoinRequest, type Role } from "@prisma/client";

import {
  isMembershipPlan,
  parseDateInput,
  MemberValidationError,
  validateFee,
  validateName,
  type MembershipPlan,
} from "../members";
import {
  AUDIT_EVENT_MEMBER_JOIN_REQUESTED,
  writeAuditEvent,
} from "./audit";
import { getPrimaryMembership } from "./authorization";
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
