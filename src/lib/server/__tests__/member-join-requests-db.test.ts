import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

import { db } from "@/lib/server/db";
import {
  MemberJoinRequestAlreadyDecidedError,
  MemberJoinRequestAuthorizationError,
  MemberJoinRequestDecisionConflictError,
  MemberJoinRequestError,
  MemberJoinRequestNotFoundError,
  MemberJoinRequestValidationError,
  approveJoinRequest,
  listPendingJoinRequests,
  rejectJoinRequest,
  submitJoinRequest,
} from "@/lib/server/member-join-requests";
import {
  MemberDuplicateError,
  createMemberWithMembership,
} from "@/lib/server/members";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const MIGRATION_SQL_PATH = path.join(
  repoRoot,
  "prisma/migrations/20261017120000_add_member_join_requests/migration.sql",
);
const SCHEMA_PATH = path.join(repoRoot, "prisma/schema.prisma");

/**
 * Member join requests on a real database (opt-in: RUN_DB_TESTS=true
 * with a disposable DATABASE_URL).
 *
 * Join submission is where an unauthenticated-but-OTP-verified caller
 * meets tenant data, so the guarantees that matter are structural:
 * the challenge claim is atomic under concurrency, a second PENDING
 * request for the same (gym, phone) is impossible even when two
 * submissions race, every existing-member state creates zero rows,
 * non-creating outcomes roll EVERYTHING back (claim, shell user,
 * request, audit), and the staff queue can only ever see its own
 * gym's requests.
 */
describe("member join request schema", () => {
  const migrationSql = readFileSync(MIGRATION_SQL_PATH, "utf8");
  const schema = readFileSync(SCHEMA_PATH, "utf8");

  it("creates member_join_requests with the full status enum", () => {
    expect(migrationSql).toMatch(/CREATE TABLE "member_join_requests"/);
    for (const status of ["PENDING", "APPROVED", "REJECTED"]) {
      expect(migrationSql).toContain(`'${status}'`);
    }
    expect(schema).toMatch(/model MemberJoinRequest \{/);
    expect(schema).toMatch(/enum MemberJoinRequestStatus/);
  });

  it("declares the partial unique index that forbids duplicate pending requests", () => {
    expect(migrationSql).toMatch(
      /CREATE UNIQUE INDEX "member_join_requests_one_pending_per_phone"/,
    );
    expect(migrationSql).toMatch(
      /ON "member_join_requests" \("organization_id", "phone_number"\)/,
    );
    expect(migrationSql).toMatch(/WHERE "status" = 'PENDING'/);
  });

  it("keeps the resulting-member link inside the tenant with a composite key", () => {
    expect(migrationSql).toMatch(
      /FOREIGN KEY \("organization_id", "resulting_member_id"\) REFERENCES "members"\("organization_id", "id"\)/,
    );
    expect(schema).toMatch(/@@index\(\[organizationId, status, createdAt\]\)/);
    expect(schema).toMatch(/@@unique\(\[organizationId, id\]\)/);
  });
});

describe("member join request decision schema (Slice 2)", () => {
  const restrictMigrationSql = readFileSync(
    path.join(
      repoRoot,
      "prisma/migrations/20261017130000_restrict_join_request_result_member_fk/migration.sql",
    ),
    "utf8",
  );
  const schema = readFileSync(SCHEMA_PATH, "utf8");

  it("replaces the resulting-member FK with ON DELETE RESTRICT", () => {
    expect(restrictMigrationSql).toMatch(
      /DROP CONSTRAINT "member_join_requests_organization_id_resulting_member_id_fkey"/,
    );
    expect(restrictMigrationSql).toMatch(
      /ADD CONSTRAINT "member_join_requests_organization_id_resulting_member_id_fkey" FOREIGN KEY \("organization_id", "resulting_member_id"\) REFERENCES "members"\("organization_id", "id"\) ON DELETE RESTRICT/,
    );
    expect(schema).toMatch(
      /"JoinRequestResult"[\s\S]*?onDelete: Restrict/,
    );
  });
});

describe.skipIf(process.env.RUN_DB_TESTS !== "true")(
  "member join requests (database)",
  () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const createdOrgIds: string[] = [];
    const createdUserIds: string[] = [];
    const usedPhones: string[] = [];
    let phoneCounter = 0;

    function nextPhone(): string {
      phoneCounter += 1;
      const phone = `98${String(phoneCounter).padStart(8, "0")}`;
      usedPhones.push(phone);
      return phone;
    }

    async function seedUser(tag: string, phone?: string) {
      const user = await db.user.create({
        data: {
          clerkUserId: `join-${tag}-${suffix}`,
          ...(phone ? { phoneNumber: phone } : {}),
        },
        select: { id: true },
      });
      createdUserIds.push(user.id);
      return user;
    }

    async function seedGym(tag: string) {
      const org = await db.organization.create({
        data: { name: `Join Gym ${tag} ${suffix}` },
        select: { id: true },
      });
      createdOrgIds.push(org.id);
      // SaaS trial fixture: gyms created through onboarding carry a
      // live trial subscription; direct seeds must too, or the
      // entitlement guard (fail closed) blocks the mutations under test.
      await db.organizationSubscription.create({
        data: {
          organizationId: org.id,
          trialStartedAt: new Date(),
          trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
        },
      });
      const owner = await seedUser(`owner-${tag}`);
      await db.organizationMembership.create({
        data: { userId: owner.id, organizationId: org.id, role: "OWNER" },
      });
      return { org, owner };
    }

    async function seedStaff(
      orgId: string,
      tag: string,
      role: "ADMIN" | "STAFF" | "TRAINER",
    ) {
      const user = await seedUser(`staff-${tag}`);
      await db.organizationMembership.create({
        data: { userId: user.id, organizationId: orgId, role },
      });
      return user;
    }

    async function seedChallenge(
      orgId: string,
      phoneNumber: string,
      overrides: {
        status?: "VERIFIED" | "PENDING";
        verifiedAt?: Date | null;
        consumedAt?: Date | null;
      } = {},
    ) {
      return db.memberOtpChallenge.create({
        data: {
          organizationId: orgId,
          phoneNumber,
          status: overrides.status ?? "VERIFIED",
          expiresAt: new Date(Date.now() + 5 * 60_000),
          verifiedAt:
            overrides.verifiedAt === undefined
              ? new Date()
              : overrides.verifiedAt,
          consumedAt: overrides.consumedAt ?? null,
        },
        select: { id: true },
      });
    }

    function validInput(orgId: string, challengeId: string) {
      return {
        organizationId: orgId,
        challengeId,
        name: "New Person",
        requestedPlan: "MONTHLY",
        proposedFee: "1500",
        proposedStartDate: "2026-11-01",
      };
    }

    async function orgCounts(orgId: string) {
      const [
        members,
        memberships,
        payments,
        paymentClaims,
        memberSessions,
        orgMemberships,
        joinRequests,
      ] = await Promise.all([
        db.member.count({ where: { organizationId: orgId } }),
        db.membership.count({ where: { organizationId: orgId } }),
        db.payment.count({ where: { organizationId: orgId } }),
        db.paymentClaim.count({ where: { organizationId: orgId } }),
        db.memberSession.count({ where: { organizationId: orgId } }),
        db.organizationMembership.count({
          where: { organizationId: orgId },
        }),
        db.memberJoinRequest.count({ where: { organizationId: orgId } }),
      ]);
      return {
        members,
        memberships,
        payments,
        paymentClaims,
        memberSessions,
        orgMemberships,
        joinRequests,
      };
    }

    beforeAll(async () => {
      await db.$queryRaw`SELECT 1`;
    });

    afterAll(async () => {
      if (createdOrgIds.length > 0) {
        await db.organization.deleteMany({
          where: { id: { in: createdOrgIds } },
        });
      }
      // Shell users created by submissions are found by their phones;
      // seeded users are tracked directly. Organizations are deleted
      // first so their audit rows (actor-restricted) are gone.
      const shellUsers = await db.user.findMany({
        where: { phoneNumber: { in: usedPhones } },
        select: { id: true },
      });
      const userIds = [
        ...new Set([...createdUserIds, ...shellUsers.map((u) => u.id)]),
      ];
      if (userIds.length > 0) {
        await db.user.deleteMany({ where: { id: { in: userIds } } });
      }
      await db.$disconnect();
    });

    it("creates the request, audit, and phone-shell user; consumes the challenge; creates nothing else", async () => {
      const { org } = await seedGym("S1");
      const phone = nextPhone();
      const before = await orgCounts(org.id);
      const challenge = await seedChallenge(org.id, phone);

      const result = await submitJoinRequest(validInput(org.id, challenge.id));
      expect(result.status).toBe("created");
      const requestId = result.status === "created" ? result.requestId : "";

      const request = await db.memberJoinRequest.findUnique({
        where: { id: requestId },
      });
      expect(request).toMatchObject({
        organizationId: org.id,
        phoneNumber: phone,
        name: "New Person",
        requestedPlan: "MONTHLY",
        status: "PENDING",
        decidedByUserId: null,
        decidedAt: null,
        resultingMemberId: null,
      });
      expect(request?.proposedFee.equals(new Prisma.Decimal("1500"))).toBe(
        true,
      );
      expect(request?.proposedStartDate.toISOString()).toBe(
        "2026-11-01T00:00:00.000Z",
      );

      // The shell user: phone only, no Clerk identity, no memberships.
      const shell = await db.user.findUnique({
        where: { phoneNumber: phone },
      });
      expect(shell).not.toBeNull();
      expect(shell?.clerkUserId).toBeNull();
      expect(request?.userId).toBe(shell?.id);
      const shellMemberships = await db.organizationMembership.count({
        where: { userId: shell!.id },
      });
      expect(shellMemberships).toBe(0);

      const consumed = await db.memberOtpChallenge.findUnique({
        where: { id: challenge.id },
        select: { consumedAt: true },
      });
      expect(consumed?.consumedAt).not.toBeNull();

      const audits = await db.auditLog.findMany({
        where: { organizationId: org.id, event: "MEMBER_JOIN_REQUESTED" },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        actorUserId: shell?.id,
        targetType: "MemberJoinRequest",
        targetId: requestId,
      });

      const after = await orgCounts(org.id);
      expect(after.members).toBe(before.members);
      expect(after.memberships).toBe(before.memberships);
      expect(after.payments).toBe(before.payments);
      expect(after.paymentClaims).toBe(before.paymentClaims);
      expect(after.memberSessions).toBe(before.memberSessions);
      expect(after.orgMemberships).toBe(before.orgMemberships);
      expect(after.joinRequests).toBe(before.joinRequests + 1);
    });

    it("validation failure touches nothing: challenge unconsumed, no request, no user", async () => {
      const { org } = await seedGym("S2");
      const phone = nextPhone();
      const challenge = await seedChallenge(org.id, phone);

      await expect(
        submitJoinRequest({
          ...validInput(org.id, challenge.id),
          proposedFee: "not-a-fee",
        }),
      ).rejects.toBeInstanceOf(MemberJoinRequestValidationError);

      const after = await db.memberOtpChallenge.findUnique({
        where: { id: challenge.id },
        select: { consumedAt: true },
      });
      expect(after?.consumedAt).toBeNull();
      expect(
        await db.memberJoinRequest.count({
          where: { organizationId: org.id },
        }),
      ).toBe(0);
      expect(await db.user.findUnique({ where: { phoneNumber: phone } })).toBeNull();
    });

    it("existing-member states create zero request rows", async () => {
      const { org } = await seedGym("S3");

      // Linkable: exactly one unlinked candidate.
      const phoneA = nextPhone();
      await db.member.create({
        data: { organizationId: org.id, name: "Pre-created", phoneNumber: phoneA },
      });
      const challengeA = await seedChallenge(org.id, phoneA);
      await expect(
        submitJoinRequest(validInput(org.id, challengeA.id)),
      ).resolves.toEqual({ status: "already_registered" });

      // Linked to this phone's user already.
      const phoneB = nextPhone();
      const userB = await seedUser("linked-b", phoneB);
      await db.member.create({
        data: {
          organizationId: org.id,
          name: "Linked",
          phoneNumber: phoneB,
          userId: userB.id,
        },
      });
      const challengeB = await seedChallenge(org.id, phoneB);
      await expect(
        submitJoinRequest(validInput(org.id, challengeB.id)),
      ).resolves.toEqual({ status: "already_registered" });

      // Multiple unlinked candidates.
      const phoneC = nextPhone();
      await db.member.create({
        data: { organizationId: org.id, name: "Dup One", phoneNumber: phoneC },
      });
      await db.member.create({
        data: { organizationId: org.id, name: "Dup Two", phoneNumber: phoneC },
      });
      const challengeC = await seedChallenge(org.id, phoneC);
      await expect(
        submitJoinRequest(validInput(org.id, challengeC.id)),
      ).resolves.toEqual({ status: "already_registered" });

      // Already linked in this gym under a different phone.
      const phoneD = nextPhone();
      const userD = await seedUser("linked-d", phoneD);
      await db.member.create({
        data: {
          organizationId: org.id,
          name: "Other Phone",
          phoneNumber: nextPhone(),
          userId: userD.id,
        },
      });
      const challengeD = await seedChallenge(org.id, phoneD);
      await expect(
        submitJoinRequest(validInput(org.id, challengeD.id)),
      ).resolves.toEqual({ status: "already_registered" });

      expect(
        await db.memberJoinRequest.count({
          where: { organizationId: org.id },
        }),
      ).toBe(0);
      // Every challenge rolled back unconsumed.
      const challenges = await db.memberOtpChallenge.findMany({
        where: { organizationId: org.id },
        select: { consumedAt: true },
      });
      expect(challenges.every((c) => c.consumedAt === null)).toBe(true);
    });

    it("linked to another user fails generically and rolls back the shell user too", async () => {
      const { org } = await seedGym("S4");
      const phone = nextPhone();
      const other = await seedUser("other-s4");
      await db.member.create({
        data: {
          organizationId: org.id,
          name: "Someone Else",
          phoneNumber: phone,
          userId: other.id,
        },
      });
      const challenge = await seedChallenge(org.id, phone);

      await expect(
        submitJoinRequest(validInput(org.id, challenge.id)),
      ).rejects.toBeInstanceOf(MemberJoinRequestError);

      // Rollback proof on the real database: the transaction's user
      // upsert, claim, and any request are all gone.
      expect(await db.user.findUnique({ where: { phoneNumber: phone } })).toBeNull();
      const after = await db.memberOtpChallenge.findUnique({
        where: { id: challenge.id },
        select: { consumedAt: true },
      });
      expect(after?.consumedAt).toBeNull();
      expect(
        await db.memberJoinRequest.count({
          where: { organizationId: org.id },
        }),
      ).toBe(0);
    });

    it("a sequential duplicate resolves to already_pending: one row, one audit, second challenge unconsumed", async () => {
      const { org } = await seedGym("S5");
      const phone = nextPhone();
      const first = await seedChallenge(org.id, phone);
      const created = await submitJoinRequest(validInput(org.id, first.id));
      expect(created.status).toBe("created");

      const second = await seedChallenge(org.id, phone);
      const duplicate = await submitJoinRequest(validInput(org.id, second.id));
      expect(duplicate.status).toBe("already_pending");
      if (created.status === "created" && duplicate.status === "already_pending") {
        expect(duplicate.requestId).toBe(created.requestId);
      }
      expect(
        await db.memberJoinRequest.count({
          where: { organizationId: org.id, status: "PENDING" },
        }),
      ).toBe(1);
      expect(
        await db.auditLog.count({
          where: { organizationId: org.id, event: "MEMBER_JOIN_REQUESTED" },
        }),
      ).toBe(1);
      const secondAfter = await db.memberOtpChallenge.findUnique({
        where: { id: second.id },
        select: { consumedAt: true },
      });
      expect(secondAfter?.consumedAt).toBeNull();
    });

    it("concurrent duplicates (two challenges, same phone+gym) produce exactly one PENDING row and one audit", async () => {
      const { org } = await seedGym("S6");
      const phone = nextPhone();
      const challengeA = await seedChallenge(org.id, phone);
      const challengeB = await seedChallenge(org.id, phone);

      const results = await Promise.allSettled([
        submitJoinRequest(validInput(org.id, challengeA.id)),
        submitJoinRequest(validInput(org.id, challengeB.id)),
      ]);
      // Neither submission may surface an unhandled error (in
      // particular not the partial index's P2002).
      const rejected = results.filter((r) => r.status === "rejected");
      expect(rejected).toHaveLength(0);
      const values = results.map(
        (r) => (r as PromiseFulfilledResult<{ status: string }>).value.status,
      );
      expect(values.sort()).toEqual(["already_pending", "created"]);

      expect(
        await db.memberJoinRequest.count({
          where: { organizationId: org.id, status: "PENDING" },
        }),
      ).toBe(1);
      expect(
        await db.auditLog.count({
          where: { organizationId: org.id, event: "MEMBER_JOIN_REQUESTED" },
        }),
      ).toBe(1);
      // Exactly one shell user and exactly one consumed challenge.
      expect(
        await db.user.count({ where: { phoneNumber: phone } }),
      ).toBe(1);
      const challenges = await db.memberOtpChallenge.findMany({
        where: { organizationId: org.id },
        select: { consumedAt: true },
      });
      expect(challenges.filter((c) => c.consumedAt !== null)).toHaveLength(1);
    });

    it("concurrent submissions sharing one challenge produce exactly one creation", async () => {
      const { org } = await seedGym("S7");
      const phone = nextPhone();
      const challenge = await seedChallenge(org.id, phone);

      const results = await Promise.allSettled([
        submitJoinRequest(validInput(org.id, challenge.id)),
        submitJoinRequest(validInput(org.id, challenge.id)),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(
        (fulfilled[0] as PromiseFulfilledResult<{ status: string }>).value
          .status,
      ).toBe("created");
      expect(rejected).toHaveLength(1);
      expect(
        (rejected[0] as PromiseRejectedResult).reason,
      ).toBeInstanceOf(MemberJoinRequestError);
      expect(
        await db.memberJoinRequest.count({
          where: { organizationId: org.id },
        }),
      ).toBe(1);
    });

    it("a challenge from another gym cannot create a request here (cross-tenant)", async () => {
      const { org: orgA } = await seedGym("S8A");
      const { org: orgB } = await seedGym("S8B");
      const phone = nextPhone();
      const challengeB = await seedChallenge(orgB.id, phone);

      await expect(
        submitJoinRequest(validInput(orgA.id, challengeB.id)),
      ).rejects.toBeInstanceOf(MemberJoinRequestError);

      expect(
        await db.memberJoinRequest.count({
          where: { organizationId: orgA.id },
        }),
      ).toBe(0);
      expect(
        await db.memberJoinRequest.count({
          where: { organizationId: orgB.id },
        }),
      ).toBe(0);
      const after = await db.memberOtpChallenge.findUnique({
        where: { id: challengeB.id },
        select: { consumedAt: true },
      });
      expect(after?.consumedAt).toBeNull();
    });

    it("the queue is isolated per gym and gated to OWNER/ADMIN/STAFF", async () => {
      const { org: orgA, owner: ownerA } = await seedGym("S9A");
      const { owner: ownerB } = await seedGym("S9B");
      const phone = nextPhone();
      const challenge = await seedChallenge(orgA.id, phone);
      const created = await submitJoinRequest(validInput(orgA.id, challenge.id));
      expect(created.status).toBe("created");

      // Gym A's owner sees it; gym B's owner sees none of it.
      const forA = await listPendingJoinRequests(ownerA.id);
      expect(forA.totalPending).toBe(1);
      expect(forA.requests[0]).toMatchObject({
        phoneNumber: phone,
        name: "New Person",
        requestedPlan: "MONTHLY",
        proposedFeePaise: 150000,
      });
      const forB = await listPendingJoinRequests(ownerB.id);
      expect(forB.totalPending).toBe(0);
      expect(forB.requests).toHaveLength(0);

      // ADMIN and STAFF of gym A may view; TRAINER may not; a user
      // with no membership may not.
      const admin = await seedStaff(orgA.id, "admin-s9", "ADMIN");
      const staff = await seedStaff(orgA.id, "staff-s9", "STAFF");
      const trainer = await seedStaff(orgA.id, "trainer-s9", "TRAINER");
      const outsider = await seedUser("outsider-s9");
      expect((await listPendingJoinRequests(admin.id)).totalPending).toBe(1);
      expect((await listPendingJoinRequests(staff.id)).totalPending).toBe(1);
      await expect(listPendingJoinRequests(trainer.id)).rejects.toBeInstanceOf(
        MemberJoinRequestAuthorizationError,
      );
      await expect(
        listPendingJoinRequests(outsider.id),
      ).rejects.toBeInstanceOf(MemberJoinRequestAuthorizationError);
    });
  },
);

describe.skipIf(process.env.RUN_DB_TESTS !== "true")(
  "member join request decisions (database)",
  () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const createdOrgIds: string[] = [];
    const createdUserIds: string[] = [];
    let phoneCounter = 100;

    function nextPhone(): string {
      phoneCounter += 1;
      return `97${String(phoneCounter).padStart(8, "0")}`;
    }

    async function seedUser(tag: string, phone?: string) {
      const user = await db.user.create({
        data: {
          clerkUserId: `join-dec-${tag}-${suffix}`,
          ...(phone ? { phoneNumber: phone } : {}),
        },
        select: { id: true },
      });
      createdUserIds.push(user.id);
      return user;
    }

    async function seedGym(tag: string) {
      const org = await db.organization.create({
        data: { name: `Decision Gym ${tag} ${suffix}` },
        select: { id: true },
      });
      createdOrgIds.push(org.id);
      // SaaS trial fixture: gyms created through onboarding carry a
      // live trial subscription; direct seeds must too, or the
      // entitlement guard (fail closed) blocks the mutations under test.
      await db.organizationSubscription.create({
        data: {
          organizationId: org.id,
          trialStartedAt: new Date(),
          trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
        },
      });
      const owner = await seedUser(`owner-${tag}`);
      await db.organizationMembership.create({
        data: { userId: owner.id, organizationId: org.id, role: "OWNER" },
      });
      return { org, owner };
    }

    async function seedStaff(
      orgId: string,
      tag: string,
      role: "ADMIN" | "STAFF" | "TRAINER",
    ) {
      const user = await seedUser(`staff-${tag}`);
      await db.organizationMembership.create({
        data: { userId: user.id, organizationId: orgId, role },
      });
      return user;
    }

    /** A PENDING request exactly as Slice 1 submission persists it. */
    async function seedPendingRequest(
      orgId: string,
      phone: string,
      overrides: { name?: string } = {},
    ) {
      const requester = await seedUser(`requester-${phone}`, phone);
      const request = await db.memberJoinRequest.create({
        data: {
          organizationId: orgId,
          userId: requester.id,
          phoneNumber: phone,
          name: overrides.name ?? "New Person",
          requestedPlan: "MONTHLY",
          proposedFee: new Prisma.Decimal("1500"),
          proposedStartDate: new Date(Date.UTC(2026, 10, 1)),
          status: "PENDING",
        },
        select: { id: true, userId: true },
      });
      return { request, requester };
    }

    const TERMS = { plan: "MONTHLY", fee: "1500", startDate: "2026-11-01" };

    async function decisionAudits(orgId: string) {
      return db.auditLog.findMany({
        where: {
          organizationId: orgId,
          event: {
            in: [
              "MEMBER_JOIN_REQUEST_APPROVED",
              "MEMBER_JOIN_REQUEST_REJECTED",
            ],
          },
        },
      });
    }

    beforeAll(async () => {
      await db.$queryRaw`SELECT 1`;
    });

    afterAll(async () => {
      if (createdOrgIds.length > 0) {
        await db.organization.deleteMany({
          where: { id: { in: createdOrgIds } },
        });
      }
      if (createdUserIds.length > 0) {
        await db.user.deleteMany({
          where: { id: { in: createdUserIds } },
        });
      }
      await db.$disconnect();
    });

    it("approve-by-create: member, membership, decision fields, and audit land atomically; no payment anywhere", async () => {
      const { org, owner } = await seedGym("D1");
      const phone = nextPhone();
      const { request, requester } = await seedPendingRequest(org.id, phone);

      const result = await approveJoinRequest(owner.id, request.id, TERMS);
      expect(result.adoptedExistingMember).toBe(false);

      const member = await db.member.findUnique({
        where: { id: result.memberId },
      });
      expect(member).toMatchObject({
        organizationId: org.id,
        name: "New Person",
        phoneNumber: phone,
        userId: requester.id,
      });

      const membership = await db.membership.findUnique({
        where: { id: result.membershipId },
      });
      expect(membership).toMatchObject({
        organizationId: org.id,
        memberId: result.memberId,
        plan: "MONTHLY",
      });
      expect(membership?.fee.equals(new Prisma.Decimal("1500"))).toBe(true);
      expect(membership?.startDate.toISOString()).toBe(
        "2026-11-01T00:00:00.000Z",
      );
      // Derived expiry: start + one calendar month (the shared rule).
      expect(membership?.expiryDate.toISOString()).toBe(
        "2026-12-01T00:00:00.000Z",
      );
      // The fee is fully outstanding: approval created no payment, so
      // the derived balance is the fee itself.
      expect(
        await db.payment.count({ where: { organizationId: org.id } }),
      ).toBe(0);
      expect(
        await db.paymentClaim.count({ where: { organizationId: org.id } }),
      ).toBe(0);

      const decided = await db.memberJoinRequest.findUnique({
        where: { id: request.id },
      });
      expect(decided).toMatchObject({
        status: "APPROVED",
        decidedByUserId: owner.id,
        resultingMemberId: result.memberId,
      });
      expect(decided?.decidedAt).not.toBeNull();

      const audits = await decisionAudits(org.id);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        event: "MEMBER_JOIN_REQUEST_APPROVED",
        actorUserId: owner.id,
        targetType: "MemberJoinRequest",
        targetId: request.id,
      });
      expect(audits[0]?.metadata).toMatchObject({
        memberId: result.memberId,
        membershipId: result.membershipId,
        plan: "MONTHLY",
        feePaise: 150000,
        adoptedExistingMember: false,
      });
    });

    it("approve end-to-end: a submitted request becomes a member with the staff-confirmed terms, not the proposed ones", async () => {
      const { org, owner } = await seedGym("D2");
      const phone = nextPhone();
      const challenge = await db.memberOtpChallenge.create({
        data: {
          organizationId: org.id,
          phoneNumber: phone,
          status: "VERIFIED",
          expiresAt: new Date(Date.now() + 5 * 60_000),
          verifiedAt: new Date(),
        },
        select: { id: true },
      });
      const submitted = await submitJoinRequest({
        organizationId: org.id,
        challengeId: challenge.id,
        name: "Walk In",
        requestedPlan: "MONTHLY",
        proposedFee: "1500",
        proposedStartDate: "2026-11-01",
      });
      expect(submitted.status).toBe("created");
      const requestId =
        submitted.status === "created" ? submitted.requestId : "";

      // Staff confirm DIFFERENT terms than proposed.
      const result = await approveJoinRequest(owner.id, requestId, {
        plan: "THREE_MONTHS",
        fee: "4000",
        startDate: "2026-11-05",
      });
      const membership = await db.membership.findUnique({
        where: { id: result.membershipId },
      });
      expect(membership?.plan).toBe("THREE_MONTHS");
      expect(membership?.fee.equals(new Prisma.Decimal("4000"))).toBe(true);
      expect(membership?.startDate.toISOString()).toBe(
        "2026-11-05T00:00:00.000Z",
      );
      expect(membership?.expiryDate.toISOString()).toBe(
        "2027-02-05T00:00:00.000Z",
      );
    });

    it("approve-by-adopt: the unlinked record is linked, not duplicated, name untouched", async () => {
      const { org, owner } = await seedGym("D3");
      const phone = nextPhone();
      const { request, requester } = await seedPendingRequest(org.id, phone);
      const existing = await db.member.create({
        data: {
          organizationId: org.id,
          name: "Staff Spelling",
          phoneNumber: phone,
        },
        select: { id: true },
      });

      const result = await approveJoinRequest(owner.id, request.id, TERMS);
      expect(result.adoptedExistingMember).toBe(true);
      expect(result.memberId).toBe(existing.id);
      expect(
        await db.member.count({ where: { organizationId: org.id } }),
      ).toBe(1);
      const adopted = await db.member.findUnique({
        where: { id: existing.id },
      });
      expect(adopted).toMatchObject({
        name: "Staff Spelling",
        userId: requester.id,
      });
    });

    it("approve uses the record already linked to the requester", async () => {
      const { org, owner } = await seedGym("D4");
      const phone = nextPhone();
      const { request, requester } = await seedPendingRequest(org.id, phone);
      const existing = await db.member.create({
        data: {
          organizationId: org.id,
          name: "Already Linked",
          phoneNumber: phone,
          userId: requester.id,
        },
        select: { id: true },
      });

      const result = await approveJoinRequest(owner.id, request.id, TERMS);
      expect(result.memberId).toBe(existing.id);
      expect(result.adoptedExistingMember).toBe(false);
      expect(
        await db.member.count({ where: { organizationId: org.id } }),
      ).toBe(1);
      expect(
        await db.membership.count({ where: { organizationId: org.id } }),
      ).toBe(1);
    });

    it("reject: decision fields + audit only; zero members, memberships, payments", async () => {
      const { org, owner } = await seedGym("D5");
      const phone = nextPhone();
      const { request } = await seedPendingRequest(org.id, phone);

      const result = await rejectJoinRequest(owner.id, request.id);
      expect(result).toEqual({ requestId: request.id });

      const decided = await db.memberJoinRequest.findUnique({
        where: { id: request.id },
      });
      expect(decided).toMatchObject({
        status: "REJECTED",
        decidedByUserId: owner.id,
        resultingMemberId: null,
      });
      expect(decided?.decidedAt).not.toBeNull();
      expect(
        await db.member.count({ where: { organizationId: org.id } }),
      ).toBe(0);
      expect(
        await db.membership.count({ where: { organizationId: org.id } }),
      ).toBe(0);
      expect(
        await db.payment.count({ where: { organizationId: org.id } }),
      ).toBe(0);
      expect(
        await db.paymentClaim.count({ where: { organizationId: org.id } }),
      ).toBe(0);
      const audits = await decisionAudits(org.id);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        event: "MEMBER_JOIN_REQUEST_REJECTED",
        actorUserId: owner.id,
        targetId: request.id,
      });
    });

    it("conflict: phone's record linked to another user aborts — request stays PENDING, zero writes", async () => {
      const { org, owner } = await seedGym("D6");
      const phone = nextPhone();
      const { request } = await seedPendingRequest(org.id, phone);
      const other = await seedUser("other-d6");
      await db.member.create({
        data: {
          organizationId: org.id,
          name: "Someone Else",
          phoneNumber: phone,
          userId: other.id,
        },
      });

      const error = await approveJoinRequest(
        owner.id,
        request.id,
        TERMS,
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(
        MemberJoinRequestDecisionConflictError,
      );
      expect(
        (error as MemberJoinRequestDecisionConflictError).reason,
      ).toBe("member_linked_elsewhere");

      const after = await db.memberJoinRequest.findUnique({
        where: { id: request.id },
      });
      expect(after?.status).toBe("PENDING");
      expect(after?.resultingMemberId).toBeNull();
      expect(
        await db.membership.count({ where: { organizationId: org.id } }),
      ).toBe(0);
      expect(await decisionAudits(org.id)).toHaveLength(0);
    });

    it("conflict: duplicate unlinked records abort instead of merging", async () => {
      const { org, owner } = await seedGym("D7");
      const phone = nextPhone();
      const { request } = await seedPendingRequest(org.id, phone);
      await db.member.create({
        data: { organizationId: org.id, name: "Dup One", phoneNumber: phone },
      });
      await db.member.create({
        data: { organizationId: org.id, name: "Dup Two", phoneNumber: phone },
      });

      const error = await approveJoinRequest(
        owner.id,
        request.id,
        TERMS,
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(
        MemberJoinRequestDecisionConflictError,
      );
      expect(
        (error as MemberJoinRequestDecisionConflictError).reason,
      ).toBe("duplicate_member_records");
      expect(
        await db.member.count({
          where: { organizationId: org.id, userId: { not: null } },
        }),
      ).toBe(0);
      const after = await db.memberJoinRequest.findUnique({
        where: { id: request.id },
      });
      expect(after?.status).toBe("PENDING");
    });

    it("conflict: a member who already has a membership blocks approval (D2)", async () => {
      const { org, owner } = await seedGym("D8");
      const phone = nextPhone();
      const { request, requester } = await seedPendingRequest(org.id, phone);
      const existing = await db.member.create({
        data: {
          organizationId: org.id,
          name: "Has Membership",
          phoneNumber: phone,
          userId: requester.id,
        },
        select: { id: true },
      });
      await db.membership.create({
        data: {
          organizationId: org.id,
          memberId: existing.id,
          plan: "MONTHLY",
          startDate: new Date(Date.UTC(2026, 10, 1)),
          expiryDate: new Date(Date.UTC(2026, 11, 1)),
          fee: new Prisma.Decimal("1500"),
        },
      });

      const error = await approveJoinRequest(
        owner.id,
        request.id,
        TERMS,
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(
        MemberJoinRequestDecisionConflictError,
      );
      expect(
        (error as MemberJoinRequestDecisionConflictError).reason,
      ).toBe("member_has_membership");
      expect(
        await db.membership.count({ where: { organizationId: org.id } }),
      ).toBe(1);
      const after = await db.memberJoinRequest.findUnique({
        where: { id: request.id },
      });
      expect(after?.status).toBe("PENDING");
      expect(await decisionAudits(org.id)).toHaveLength(0);
    });

    it("tenant isolation: a foreign request is indistinguishable from a nonexistent one; staff of that gym CAN decide it", async () => {
      const { org: orgA, owner: ownerA } = await seedGym("D9A");
      const { org: orgB } = await seedGym("D9B");
      const phone = nextPhone();
      const { request } = await seedPendingRequest(orgB.id, phone);

      // ownerA has no membership in orgB: same error as a random ID.
      await expect(
        approveJoinRequest(ownerA.id, request.id, TERMS),
      ).rejects.toBeInstanceOf(MemberJoinRequestNotFoundError);
      await expect(
        rejectJoinRequest(ownerA.id, request.id),
      ).rejects.toBeInstanceOf(MemberJoinRequestNotFoundError);
      await expect(
        approveJoinRequest(ownerA.id, crypto.randomUUID(), TERMS),
      ).rejects.toBeInstanceOf(MemberJoinRequestNotFoundError);
      const untouched = await db.memberJoinRequest.findUnique({
        where: { id: request.id },
      });
      expect(untouched?.status).toBe("PENDING");
      expect(
        await db.member.count({ where: { organizationId: orgB.id } }),
      ).toBe(0);

      // The same person, as ADMIN of orgB, decides it there: the
      // request's own gym scopes the decision, not the primary gym.
      await db.organizationMembership.create({
        data: { userId: ownerA.id, organizationId: orgB.id, role: "ADMIN" },
      });
      const result = await approveJoinRequest(ownerA.id, request.id, TERMS);
      expect(result.memberId).toBeTruthy();
      const decided = await db.memberJoinRequest.findUnique({
        where: { id: request.id },
      });
      expect(decided?.status).toBe("APPROVED");
      // Nothing leaked into orgA.
      expect(
        await db.member.count({ where: { organizationId: orgA.id } }),
      ).toBe(0);
    });

    it("authorization: TRAINER cannot decide; a removed or demoted actor is stopped by revalidation", async () => {
      const { org } = await seedGym("D10");
      const phone = nextPhone();
      const { request } = await seedPendingRequest(org.id, phone);
      const trainer = await seedStaff(org.id, "trainer-d10", "TRAINER");
      await expect(
        approveJoinRequest(trainer.id, request.id, TERMS),
      ).rejects.toBeInstanceOf(MemberJoinRequestAuthorizationError);
      await expect(
        rejectJoinRequest(trainer.id, request.id),
      ).rejects.toBeInstanceOf(MemberJoinRequestAuthorizationError);

      // Demotion committed before the decision: the locked in-tx
      // revalidation sees TRAINER and denies (the claims pattern).
      const staff = await seedStaff(org.id, "staff-d10", "STAFF");
      await db.organizationMembership.updateMany({
        where: { userId: staff.id, organizationId: org.id },
        data: { role: "TRAINER" },
      });
      await expect(
        approveJoinRequest(staff.id, request.id, TERMS),
      ).rejects.toBeInstanceOf(MemberJoinRequestAuthorizationError);

      // Removal committed before the decision: no row in this gym —
      // the indistinguishable not-found outcome.
      const admin = await seedStaff(org.id, "admin-d10", "ADMIN");
      await db.organizationMembership.deleteMany({
        where: { userId: admin.id, organizationId: org.id },
      });
      await expect(
        approveJoinRequest(admin.id, request.id, TERMS),
      ).rejects.toBeInstanceOf(MemberJoinRequestNotFoundError);

      const after = await db.memberJoinRequest.findUnique({
        where: { id: request.id },
      });
      expect(after?.status).toBe("PENDING");
      expect(await decisionAudits(org.id)).toHaveLength(0);
    });

    it("double decision: approve then reject (and reject then approve) fail as already-decided with a single audit", async () => {
      const { org, owner } = await seedGym("D11");
      const phoneA = nextPhone();
      const first = await seedPendingRequest(org.id, phoneA);
      await approveJoinRequest(owner.id, first.request.id, TERMS);
      await expect(
        rejectJoinRequest(owner.id, first.request.id),
      ).rejects.toBeInstanceOf(MemberJoinRequestAlreadyDecidedError);
      await expect(
        approveJoinRequest(owner.id, first.request.id, TERMS),
      ).rejects.toBeInstanceOf(MemberJoinRequestAlreadyDecidedError);

      const phoneB = nextPhone();
      const second = await seedPendingRequest(org.id, phoneB);
      await rejectJoinRequest(owner.id, second.request.id);
      await expect(
        approveJoinRequest(owner.id, second.request.id, TERMS),
      ).rejects.toBeInstanceOf(MemberJoinRequestAlreadyDecidedError);

      expect(await decisionAudits(org.id)).toHaveLength(2);
      expect(
        await db.member.count({ where: { organizationId: org.id } }),
      ).toBe(1);
      expect(
        await db.membership.count({ where: { organizationId: org.id } }),
      ).toBe(1);
    });

    it("concurrency: two parallel approvals produce exactly one member, one membership, one audit", async () => {
      const { org, owner } = await seedGym("D12");
      const staff = await seedStaff(org.id, "staff-d12", "STAFF");
      const phone = nextPhone();
      const { request } = await seedPendingRequest(org.id, phone);

      const results = await Promise.allSettled([
        approveJoinRequest(owner.id, request.id, TERMS),
        approveJoinRequest(staff.id, request.id, TERMS),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(
        (rejected[0] as PromiseRejectedResult).reason,
      ).toBeInstanceOf(MemberJoinRequestAlreadyDecidedError);

      expect(
        await db.member.count({ where: { organizationId: org.id } }),
      ).toBe(1);
      expect(
        await db.membership.count({ where: { organizationId: org.id } }),
      ).toBe(1);
      const audits = await decisionAudits(org.id);
      expect(audits).toHaveLength(1);
      expect(audits[0]?.event).toBe("MEMBER_JOIN_REQUEST_APPROVED");
    });

    it("concurrency: approve racing reject lands exactly one decision", async () => {
      const { org, owner } = await seedGym("D13");
      const staff = await seedStaff(org.id, "staff-d13", "STAFF");
      const phone = nextPhone();
      const { request } = await seedPendingRequest(org.id, phone);

      const results = await Promise.allSettled([
        approveJoinRequest(owner.id, request.id, TERMS),
        rejectJoinRequest(staff.id, request.id),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(
        (rejected[0] as PromiseRejectedResult).reason,
      ).toBeInstanceOf(MemberJoinRequestAlreadyDecidedError);

      const decided = await db.memberJoinRequest.findUnique({
        where: { id: request.id },
      });
      const audits = await decisionAudits(org.id);
      expect(audits).toHaveLength(1);
      if (decided?.status === "APPROVED") {
        expect(audits[0]?.event).toBe("MEMBER_JOIN_REQUEST_APPROVED");
        expect(
          await db.membership.count({ where: { organizationId: org.id } }),
        ).toBe(1);
        expect(decided.resultingMemberId).not.toBeNull();
      } else {
        expect(decided?.status).toBe("REJECTED");
        expect(audits[0]?.event).toBe("MEMBER_JOIN_REQUEST_REJECTED");
        expect(
          await db.member.count({ where: { organizationId: org.id } }),
        ).toBe(0);
      }
    });

    it("concurrency: approval vs staff creation for the same phone — exactly one wins; one member, one membership (3 rounds)", async () => {
      // Both critical sections hold the same (gym, phone) advisory
      // lock, and the staff duplicate check runs inside the creation
      // transaction under that lock — so the two operations fully
      // linearize and exactly one of them can commit. (This replaces
      // the looser race assertions from the original Slice 2 pass,
      // which tolerated a duplicate member pair because the staff
      // pre-check ran before the transaction.)
      for (let round = 0; round < 3; round += 1) {
        const { org, owner } = await seedGym(`C1-${round}`);
        const phone = nextPhone();
        const { request, requester } = await seedPendingRequest(org.id, phone);

        const [approveResult, createResult] = await Promise.allSettled([
          approveJoinRequest(owner.id, request.id, TERMS),
          createMemberWithMembership(owner.id, {
            name: "Staff Created",
            phoneNumber: phone,
            fee: "1500",
            plan: "MONTHLY",
            startDate: "2026-11-01",
          }),
        ]);

        const fulfilled = [approveResult, createResult].filter(
          (r) => r.status === "fulfilled",
        );
        expect(fulfilled).toHaveLength(1);

        // Exactly one member for the phone, exactly one membership
        // in the gym, and it belongs to that member — never stacked,
        // never mis-targeted.
        const members = await db.member.findMany({
          where: { organizationId: org.id, phoneNumber: phone },
        });
        expect(members).toHaveLength(1);
        const member = members[0];
        const memberships = await db.membership.findMany({
          where: { organizationId: org.id },
        });
        expect(memberships).toHaveLength(1);
        expect(memberships[0]?.memberId).toBe(member?.id);

        const decided = await db.memberJoinRequest.findUnique({
          where: { id: request.id },
        });
        if (approveResult.status === "fulfilled") {
          // Approval won: the request produced the only member, and
          // the staff creation observed it under the lock and was
          // refused as a duplicate of exactly that member.
          expect(createResult.status).toBe("rejected");
          if (createResult.status === "rejected") {
            expect(createResult.reason).toBeInstanceOf(MemberDuplicateError);
            expect(
              (
                createResult.reason as MemberDuplicateError
              ).duplicates.map((d) => d.id),
            ).toContain(member?.id);
          }
          expect(decided?.status).toBe("APPROVED");
          expect(decided?.resultingMemberId).toBe(member?.id);
          expect(member?.userId).toBe(requester.id);
          expect(
            (await decisionAudits(org.id)).filter(
              (a) => a.event === "MEMBER_JOIN_REQUEST_APPROVED",
            ),
          ).toHaveLength(1);
        } else {
          // Staff creation won: approval adopted nothing — the D2
          // guard saw the staff member's membership and stopped it,
          // leaving the request pending for a later decision.
          expect(approveResult.reason).toBeInstanceOf(
            MemberJoinRequestDecisionConflictError,
          );
          expect(
            (approveResult.reason as MemberJoinRequestDecisionConflictError)
              .reason,
          ).toBe("member_has_membership");
          expect(decided?.status).toBe("PENDING");
          expect(decided?.resultingMemberId).toBeNull();
          expect(member?.userId).toBeNull();
          expect(await decisionAudits(org.id)).toHaveLength(0);
        }
        expect(
          await db.payment.count({ where: { organizationId: org.id } }),
        ).toBe(0);
        expect(
          await db.paymentClaim.count({ where: { organizationId: org.id } }),
        ).toBe(0);
      }
    });

    it("concurrency: approval vs staff creation WITH allowDuplicate — the override still lands; one membership per member", async () => {
      const { org, owner } = await seedGym("C2");
      const phone = nextPhone();
      const { request } = await seedPendingRequest(org.id, phone);

      const [approveResult, createResult] = await Promise.allSettled([
        approveJoinRequest(owner.id, request.id, TERMS),
        createMemberWithMembership(
          owner.id,
          {
            name: "Staff Created",
            phoneNumber: phone,
            fee: "1500",
            plan: "MONTHLY",
            startDate: "2026-11-01",
          },
          { allowDuplicate: true },
        ),
      ]);

      // The explicit override skips the duplicate check entirely, so
      // the staff creation always lands. Approval either wins the
      // lock first (both succeed — the acknowledged duplicate pair,
      // each member with its own single membership) or finds the
      // staff member's membership and stops at the D2 guard.
      expect(createResult.status).toBe("fulfilled");
      const members = await db.member.findMany({
        where: { organizationId: org.id, phoneNumber: phone },
        include: { memberships: true },
      });
      for (const member of members) {
        expect(member.memberships).toHaveLength(1);
      }
      const decided = await db.memberJoinRequest.findUnique({
        where: { id: request.id },
      });
      if (approveResult.status === "fulfilled") {
        expect(members).toHaveLength(2);
        const winner = members.find(
          (m) => m.id === decided?.resultingMemberId,
        );
        expect(winner?.memberships).toHaveLength(1);
        expect(winner?.userId).toBe(decided?.userId);
        expect(decided?.status).toBe("APPROVED");
      } else {
        expect(approveResult.reason).toBeInstanceOf(
          MemberJoinRequestDecisionConflictError,
        );
        expect(
          (approveResult.reason as MemberJoinRequestDecisionConflictError)
            .reason,
        ).toBe("member_has_membership");
        expect(members).toHaveLength(1);
        expect(decided?.status).toBe("PENDING");
        expect(decided?.resultingMemberId).toBeNull();
      }
    });

    it("concurrency: two staff creations for the same phone — exactly one succeeds (lives here: no members DB suite exists)", async () => {
      const { org, owner } = await seedGym("C3");
      const phone = nextPhone();
      const input = {
        name: "Staff Created",
        phoneNumber: phone,
        fee: "1500",
        plan: "MONTHLY",
        startDate: "2026-11-01",
      };

      // Both creations take the same advisory lock and run the
      // duplicate check inside their transactions, so the second to
      // acquire the lock observes the first's committed member.
      const results = await Promise.allSettled([
        createMemberWithMembership(owner.id, input),
        createMemberWithMembership(owner.id, {
          ...input,
          name: "Second Attempt",
        }),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(
        (rejected[0] as PromiseRejectedResult).reason,
      ).toBeInstanceOf(MemberDuplicateError);

      const members = await db.member.findMany({
        where: { organizationId: org.id, phoneNumber: phone },
      });
      expect(members).toHaveLength(1);
      const memberships = await db.membership.findMany({
        where: { organizationId: org.id },
      });
      expect(memberships).toHaveLength(1);
      expect(memberships[0]?.memberId).toBe(members[0]?.id);
    });

    it("after approval, staff member creation for the same phone is a duplicate; total memberships stay 1", async () => {
      const { org, owner } = await seedGym("D15");
      const phone = nextPhone();
      const { request } = await seedPendingRequest(org.id, phone);

      const result = await approveJoinRequest(owner.id, request.id, TERMS);
      await expect(
        createMemberWithMembership(owner.id, {
          name: "Staff Created",
          phoneNumber: phone,
          fee: "1500",
          plan: "MONTHLY",
          startDate: "2026-11-01",
        }),
      ).rejects.toBeInstanceOf(MemberDuplicateError);

      const memberships = await db.membership.findMany({
        where: { organizationId: org.id },
      });
      expect(memberships).toHaveLength(1);
      expect(memberships[0]?.memberId).toBe(result.memberId);
    });

    it("the resulting-member FK is RESTRICT in the live database: a decided request's member cannot be deleted, an unreferenced one can", async () => {
      const rows = await db.$queryRaw<{ confdeltype: string }[]>`
        SELECT confdeltype::text AS confdeltype FROM pg_constraint
        WHERE conname = 'member_join_requests_organization_id_resulting_member_id_fkey'
      `;
      expect(rows[0]?.confdeltype).toBe("r");

      const { org, owner } = await seedGym("D16");
      const phone = nextPhone();
      const { request } = await seedPendingRequest(org.id, phone);
      const result = await approveJoinRequest(owner.id, request.id, TERMS);

      await expect(
        db.member.delete({ where: { id: result.memberId } }),
      ).rejects.toThrow();
      expect(
        await db.member.findUnique({ where: { id: result.memberId } }),
      ).not.toBeNull();

      const free = await db.member.create({
        data: {
          organizationId: org.id,
          name: "Unreferenced",
          phoneNumber: nextPhone(),
        },
        select: { id: true },
      });
      await db.member.delete({ where: { id: free.id } });
      expect(
        await db.member.findUnique({ where: { id: free.id } }),
      ).toBeNull();
    });
  },
);
