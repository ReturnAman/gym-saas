import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

import { db } from "@/lib/server/db";
import {
  MemberJoinRequestAuthorizationError,
  MemberJoinRequestError,
  MemberJoinRequestValidationError,
  listPendingJoinRequests,
  submitJoinRequest,
} from "@/lib/server/member-join-requests";

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

describe.skipIf(process.env.RUN_DB_TESTS !== "true")(
  "member join requests (database)",
  () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const createdOrgIds: string[] = [];
    const createdUserIds: string[] = [];
    const usedPhones: string[] = [];
    let phoneCounter = 0;
    let challengeCounter = 0;

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
      challengeCounter += 1;
      return db.memberOtpChallenge.create({
        data: {
          organizationId: orgId,
          phoneNumber,
          providerSessionId: `join-test-${suffix}-${challengeCounter}`,
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
