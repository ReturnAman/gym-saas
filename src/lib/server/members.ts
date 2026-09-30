import "server-only";

import { Prisma, type Role } from "@prisma/client";

import {
  MEMBERSHIP_EXPIRING_WITHIN_DAYS,
  PLAN_LABELS,
  deriveMembershipPayments,
  deriveMembershipStatus,
  derivePaymentStatus,
  startOfUtcDay,
  validateMemberInput,
  validateName,
  validatePhoneNumber,
  type MembershipPlan,
  type MembershipStatus,
  type PaymentStatus,
} from "../members";
import { getPrimaryMembership } from "./authorization";
import { db } from "./db";

/**
 * Server-side Member/Membership service (docs/04-DATABASE-DESIGN §9, §11,
 * docs/05-AUTHORIZATION.md §8 V1 permission matrix).
 *
 * Tenant isolation: every query is scoped by the organization ID resolved
 * from the authenticated user's own membership — never from client input.
 * A member/membership ID alone never grants access (IDOR protection): the
 * organization ID is always part of the lookup predicate, so a row from
 * Organization B is indistinguishable from a missing row.
 *
 * Permission model (matrix §8):
 * - View members: OWNER, ADMIN, STAFF yes; TRAINER "limited"; MEMBER own-only.
 * - Create members + create/update memberships: OWNER, ADMIN, STAFF.
 * - Edit members: OWNER, ADMIN, STAFF yes; TRAINER "limited"; MEMBER no.
 *
 * "Limited" is not defined precisely in the matrix. This slice treats it as:
 * TRAINER may view the members list and member details (the role's
 * definition explicitly includes "view permitted member information"), but
 * may not create or edit members. The exact field-level meaning of
 * "limited" needs a product decision (flagged in the implementation report).
 */

/** Thrown when the caller lacks permission or the tenant scope fails. */
export class MemberAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemberAuthorizationError";
  }
}

/** Thrown when a member cannot be found inside the caller's organization. */
export class MemberNotFoundError extends Error {
  constructor() {
    super("Member not found.");
    this.name = "MemberNotFoundError";
  }
}

export interface DuplicateMember {
  id: string;
  name: string;
  phoneNumber: string;
}

/**
 * Thrown when other members in the same organization already use the phone
 * number. The conflicting records are returned so the UI can surface them
 * and the user can decide — duplicates are never silently merged.
 */
export class MemberDuplicateError extends Error {
  duplicates: DuplicateMember[];

  constructor(duplicates: DuplicateMember[]) {
    super("Another member already uses this phone number.");
    this.name = "MemberDuplicateError";
    this.duplicates = duplicates;
  }
}

export interface MemberPermissions {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
}

export function getMemberPermissions(role: Role): MemberPermissions {
  const staff = role === "OWNER" || role === "ADMIN" || role === "STAFF";
  return {
    // TRAINER "limited" view: allowed (see module header). MEMBER is
    // handled separately as own-only scoping, not a boolean.
    canView: staff || role === "TRAINER",
    canCreate: staff,
    canEdit: staff,
  };
}

interface MemberScope {
  userId: string;
  organizationId: string;
  role: Role;
}

/**
 * Resolve the caller's tenant scope from their own organization membership.
 * The organization ID is never accepted from the caller.
 */
async function resolveScope(userId: string): Promise<MemberScope> {
  if (!userId) {
    throw new MemberAuthorizationError("Authentication is required.");
  }
  const membership = await getPrimaryMembership(userId);
  if (!membership) {
    throw new MemberAuthorizationError("You do not belong to an organization.");
  }
  return {
    userId,
    organizationId: membership.organizationId,
    role: membership.role,
  };
}

/** Prisma.Decimal → integer paise (exact; Decimal mul is not floating point). */
function decimalToPaise(value: Prisma.Decimal): number {
  return value.mul(100).toNumber();
}

/** UTC-midnight Date → "YYYY-MM-DD". */
function toDateString(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export interface MemberListFilters {
  search?: string;
  membershipStatus?: MembershipStatus;
  paymentStatus?: PaymentStatus;
  page?: number;
  pageSize?: number;
}

export interface MemberListItem {
  id: string;
  name: string;
  phoneNumber: string;
  plan: MembershipPlan | null;
  planLabel: string | null;
  startDate: string | null;
  expiryDate: string | null;
  membershipStatus: MembershipStatus | null;
  paymentStatus: PaymentStatus | null;
  feePaise: number | null;
  /**
   * Domain-derived, not a persisted balance: paid is always ₹0 in this
   * slice (no payment domain yet) and outstanding is the full fee. See
   * deriveMembershipPayments in src/lib/members.ts.
   */
  paidPaise: number | null;
  outstandingPaise: number | null;
}

export interface MemberListResult {
  items: MemberListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * Build the membership sub-filter for derived statuses. There is no payment
 * domain yet, so paid is always ₹0 in this slice: payment status is exactly
 * determined by the fee (fee = 0 → PAID, fee > 0 → UNPAID) and
 * PARTIALLY_PAID cannot occur. This must be generalized when payment
 * claims land.
 */
function membershipSubFilter(
  membershipStatus: MembershipStatus | undefined,
  paymentStatus: PaymentStatus | undefined,
): Prisma.MembershipWhereInput | undefined {
  const conditions: Prisma.MembershipWhereInput[] = [];

  if (membershipStatus) {
    const today = startOfUtcDay(new Date());
    if (membershipStatus === "EXPIRED") {
      conditions.push({ expiryDate: { lt: today } });
    } else if (membershipStatus === "EXPIRING") {
      const horizon = new Date(
        today.getTime() + MEMBERSHIP_EXPIRING_WITHIN_DAYS * 86_400_000,
      );
      conditions.push({ expiryDate: { gte: today, lte: horizon } });
    } else {
      conditions.push({ expiryDate: { gte: today } });
    }
  }

  if (paymentStatus === "PAID") {
    conditions.push({ fee: { lte: 0 } });
  } else if (paymentStatus === "UNPAID") {
    conditions.push({ fee: { gt: 0 } });
  } else if (paymentStatus === "PARTIALLY_PAID") {
    // No payment domain exists yet (paid is always ₹0), so no membership
    // can be partially paid. Keep the filter value accepted by the UI but
    // match nothing, rather than silently dropping the filter and showing
    // unfiltered results. Generalize when payment claims land.
    conditions.push({ id: { in: [] } });
  }

  if (conditions.length === 0) return undefined;
  return { AND: conditions };
}

export async function listMembers(
  userId: string,
  filters: MemberListFilters = {},
): Promise<MemberListResult> {
  const scope = await resolveScope(userId);
  const permissions = getMemberPermissions(scope.role);
  if (!permissions.canView && scope.role !== "MEMBER") {
    throw new MemberAuthorizationError(
      "You do not have permission to view members.",
    );
  }

  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(filters.pageSize ?? DEFAULT_PAGE_SIZE)),
  );
  const search = (filters.search ?? "").trim();

  const membershipFilter = membershipSubFilter(
    filters.membershipStatus,
    filters.paymentStatus,
  );

  const where: Prisma.MemberWhereInput = { organizationId: scope.organizationId };
  // MEMBER role: own record only (linked at OTP onboarding via userId).
  if (scope.role === "MEMBER") {
    where.userId = scope.userId;
  }
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { phoneNumber: { contains: search } },
    ];
  }
  if (membershipFilter) {
    where.memberships = { some: membershipFilter };
  }

  const [total, members] = await Promise.all([
    db.member.count({ where }),
    db.member.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        memberships: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
  ]);

  const items: MemberListItem[] = members.map((member) => {
    const latest = member.memberships[0];
    if (!latest) {
      return {
        id: member.id,
        name: member.name,
        phoneNumber: member.phoneNumber,
        plan: null,
        planLabel: null,
        startDate: null,
        expiryDate: null,
        membershipStatus: null,
        paymentStatus: null,
        feePaise: null,
        paidPaise: null,
        outstandingPaise: null,
      };
    }
    const feePaise = decimalToPaise(latest.fee);
    // No payment domain yet — paid/outstanding are derived, never stored.
    const { paidPaise, outstandingPaise } = deriveMembershipPayments(feePaise);
    return {
      id: member.id,
      name: member.name,
      phoneNumber: member.phoneNumber,
      plan: latest.plan,
      planLabel: PLAN_LABELS[latest.plan],
      startDate: toDateString(latest.startDate),
      expiryDate: toDateString(latest.expiryDate),
      membershipStatus: deriveMembershipStatus(latest.expiryDate),
      paymentStatus: derivePaymentStatus(feePaise, paidPaise),
      feePaise,
      paidPaise,
      outstandingPaise,
    };
  });

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

// ---------------------------------------------------------------------------
// Details
// ---------------------------------------------------------------------------

export interface MemberDetailMembership {
  id: string;
  plan: MembershipPlan;
  planLabel: string;
  startDate: string;
  expiryDate: string;
  feePaise: number;
  /**
   * Domain-derived, not a persisted balance: paid is always ₹0 in this
   * slice (no payment domain yet) and outstanding is the full fee. See
   * deriveMembershipPayments in src/lib/members.ts.
   */
  paidPaise: number;
  outstandingPaise: number;
  membershipStatus: MembershipStatus;
  paymentStatus: PaymentStatus;
}

export interface MemberDetail {
  id: string;
  name: string;
  phoneNumber: string;
  membership: MemberDetailMembership | null;
  permissions: MemberPermissions;
}

/**
 * Load one member inside the caller's organization. Returns null when the
 * member does not exist, belongs to another organization, or the caller's
 * role may not see it — all three are indistinguishable (no IDOR oracle).
 */
export async function getMemberDetail(
  userId: string,
  memberId: string,
): Promise<MemberDetail | null> {
  const scope = await resolveScope(userId);
  const permissions = getMemberPermissions(scope.role);
  if (!permissions.canView && scope.role !== "MEMBER") {
    return null;
  }

  const member = await db.member.findFirst({
    where: { id: memberId, organizationId: scope.organizationId },
    include: {
      memberships: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!member) return null;
  // MEMBER role: own record only.
  if (scope.role === "MEMBER" && member.userId !== scope.userId) {
    return null;
  }

  const latest = member.memberships[0] ?? null;
  let membership: MemberDetailMembership | null = null;
  if (latest) {
    const feePaise = decimalToPaise(latest.fee);
    // No payment domain yet — paid/outstanding are derived, never stored.
    const { paidPaise, outstandingPaise } = deriveMembershipPayments(feePaise);
    membership = {
      id: latest.id,
      plan: latest.plan,
      planLabel: PLAN_LABELS[latest.plan],
      startDate: toDateString(latest.startDate),
      expiryDate: toDateString(latest.expiryDate),
      feePaise,
      paidPaise,
      outstandingPaise,
      membershipStatus: deriveMembershipStatus(latest.expiryDate),
      paymentStatus: derivePaymentStatus(feePaise, paidPaise),
    };
  }

  return {
    id: member.id,
    name: member.name,
    phoneNumber: member.phoneNumber,
    membership,
    permissions,
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateMemberInput {
  name: string;
  phoneNumber: string;
  fee: string;
  plan: string;
  startDate: string;
}

async function findDuplicatePhones(
  organizationId: string,
  phoneNumber: string,
  excludeMemberId?: string,
): Promise<DuplicateMember[]> {
  return db.member.findMany({
    where: {
      organizationId,
      phoneNumber,
      ...(excludeMemberId ? { id: { not: excludeMemberId } } : {}),
    },
    select: { id: true, name: true, phoneNumber: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
}

/**
 * Create a member together with their first membership, atomically.
 *
 * Authorization: OWNER/ADMIN/STAFF only (matrix: create members + create/
 * update memberships). The organization comes from the caller's membership.
 *
 * Unless `allowDuplicate` is set, an existing member with the same phone
 * number in the organization aborts creation with MemberDuplicateError so
 * the UI can surface the conflict for an explicit user decision.
 */
export async function createMemberWithMembership(
  userId: string,
  input: CreateMemberInput,
  opts: { allowDuplicate?: boolean } = {},
): Promise<{ memberId: string }> {
  const scope = await resolveScope(userId);
  if (!getMemberPermissions(scope.role).canCreate) {
    throw new MemberAuthorizationError(
      "You do not have permission to add members.",
    );
  }

  const validated = validateMemberInput(input);

  if (!opts.allowDuplicate) {
    const duplicates = await findDuplicatePhones(
      scope.organizationId,
      validated.phoneNumber,
    );
    if (duplicates.length > 0) {
      throw new MemberDuplicateError(duplicates);
    }
  }

  const memberId = await db.$transaction(async (tx) => {
    const member = await tx.member.create({
      data: {
        organizationId: scope.organizationId,
        name: validated.name,
        phoneNumber: validated.phoneNumber,
      },
      select: { id: true },
    });
    await tx.membership.create({
      data: {
        organizationId: scope.organizationId,
        memberId: member.id,
        plan: validated.plan,
        startDate: validated.startDate,
        expiryDate: validated.expiryDate,
        // Exact Decimal from integer paise — no floating point. No
        // paid_amount column exists: paid/outstanding are derived, not
        // persisted (see deriveMembershipPayments).
        //
        // The composite foreign key (organization_id, member_id) →
        // members(organization_id, id) additionally guarantees the
        // membership's organization matches the member's, at the database
        // level — a mismatched pairing cannot be persisted even if
        // application code passed inconsistent values.
        fee: new Prisma.Decimal(validated.feePaise).div(100),
      },
    });
    return member.id;
  });

  return { memberId };
}

// ---------------------------------------------------------------------------
// Edit (identity/contact only — membership/payment history is never rewritten)
// ---------------------------------------------------------------------------

export interface UpdateMemberInput {
  name: string;
  phoneNumber: string;
}

/**
 * Update a member's identity/contact fields. Membership fields (plan, dates,
 * fee) are intentionally not editable here: the finalized UX keeps edit
 * focused on the member's own fields, and rewriting membership terms would
 * silently alter historical meaning. Renewals/changes to terms arrive as
 * separate operations in later slices.
 */
export async function updateMember(
  userId: string,
  memberId: string,
  input: UpdateMemberInput,
  opts: { allowDuplicate?: boolean } = {},
): Promise<void> {
  const scope = await resolveScope(userId);
  if (!getMemberPermissions(scope.role).canEdit) {
    throw new MemberAuthorizationError(
      "You do not have permission to edit members.",
    );
  }

  const member = await db.member.findFirst({
    where: { id: memberId, organizationId: scope.organizationId },
    select: { id: true },
  });
  if (!member) {
    throw new MemberNotFoundError();
  }

  const name = validateName(input.name);
  const phoneNumber = validatePhoneNumber(input.phoneNumber);

  const duplicates = await findDuplicatePhones(
    scope.organizationId,
    phoneNumber,
    member.id,
  );
  if (duplicates.length > 0 && !opts.allowDuplicate) {
    throw new MemberDuplicateError(duplicates);
  }

  await db.member.update({
    where: { id: member.id },
    data: { name, phoneNumber },
  });
}
