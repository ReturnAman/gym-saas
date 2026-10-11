import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Staff Management V1 — tenant-integrity and concurrency proof against a
 * real PostgreSQL database.
 *
 * Only the Clerk directory is faked (staff accounts are resolved from a
 * local email → Clerk ID map): every authorization, uniqueness,
 * transaction, and audit behavior under test here is the real service
 * against the real schema. The Clerk lookup contract itself is covered
 * by the mocked unit suite (staff.test.ts).
 *
 * No database is available in CI, so this suite is skipped unless
 * explicitly enabled:
 *
 *   RUN_DB_TESTS=true DATABASE_URL=postgresql://... npx vitest run \
 *     src/lib/server/__tests__/staff-tenant-integrity.test.ts
 *
 * Run it after `prisma migrate deploy` applies all migrations.
 */

const { directoryByEmail, directoryHookRef } = vi.hoisted(() => ({
  directoryByEmail: new Map<
    string,
    { clerkUserId: string; displayName: string | null }
  >(),
  // Optional side effect run inside the directory lookup, used to land a
  // concurrent committed change (revocation/downgrade of the ACTOR)
  // while the staff request is "in flight" on the network call — the
  // exact interleaving the mutation-boundary revalidation defends.
  directoryHookRef: {
    current: null as null | (() => Promise<void>),
  },
}));

vi.mock("@/lib/server/clerk-directory", () => {
  class ClerkDirectoryUnavailableError extends Error {
    constructor(message = "unavailable") {
      super(message);
      this.name = "ClerkDirectoryUnavailableError";
    }
  }
  return {
    ClerkDirectoryUnavailableError,
    findClerkUserByVerifiedEmail: async (email: string) => {
      if (directoryHookRef.current) {
        await directoryHookRef.current();
      }
      return directoryByEmail.get(email) ?? null;
    },
  };
});

import { db } from "@/lib/server/db";
import { createOrganization } from "@/lib/server/organizations";
import {
  StaffAuthorizationError,
  StaffConflictError,
  StaffNotFoundError,
  addOrganizationStaff,
  changeOrganizationStaffRole,
  listOrganizationStaff,
  revokeOrganizationStaffAccess,
} from "@/lib/server/staff";

describe.skipIf(process.env.RUN_DB_TESTS !== "true")(
  "staff management database enforcement",
  () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const createdOrgIds: string[] = [];
    const createdUserIds: string[] = [];

    let ownerA = "";
    let ownerB = "";
    let orgA = "";
    let orgB = "";

    async function makeUser(label: string): Promise<string> {
      const user = await db.user.create({
        data: { clerkUserId: `staff-it-${label}-${suffix}` },
        select: { id: true },
      });
      createdUserIds.push(user.id);
      return user.id;
    }

    async function registerEmail(email: string, userId: string) {
      const row = await db.user.findUnique({
        where: { id: userId },
        select: { clerkUserId: true },
      });
      directoryByEmail.set(email, {
        clerkUserId: row!.clerkUserId!,
        displayName: null,
      });
    }

    async function auditEvents(organizationId: string, event: string) {
      return db.auditLog.findMany({
        where: { organizationId, event },
        orderBy: { createdAt: "asc" },
      });
    }

    beforeAll(async () => {
      await db.$queryRaw`SELECT 1`;
      ownerA = await makeUser("owner-a");
      ownerB = await makeUser("owner-b");
      const a = await createOrganization(ownerA, {
        name: `Staff IT Gym A ${suffix}`,
      });
      const b = await createOrganization(ownerB, {
        name: `Staff IT Gym B ${suffix}`,
      });
      orgA = a.id;
      orgB = b.id;
      createdOrgIds.push(orgA, orgB);
    });

    afterAll(async () => {
      if (createdOrgIds.length > 0) {
        await db.organization.deleteMany({
          where: { id: { in: createdOrgIds } },
        });
      }
      if (createdUserIds.length > 0) {
        await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
      }
      await db.$disconnect();
    });

    it("adds staff with an audit event, and lists them for the owner", async () => {
      const staffUser = await makeUser("staff-1");
      await registerEmail(`staff-1-${suffix}@example.com`, staffUser);
      const created = await addOrganizationStaff(ownerA, {
        email: `staff-1-${suffix}@example.com`,
        role: "STAFF",
      });
      expect(created.userId).toBe(staffUser);
      expect(created.organizationId).toBe(orgA);

      const list = await listOrganizationStaff(ownerA);
      expect(list.map((row) => row.userId)).toContain(staffUser);

      const events = await auditEvents(orgA, "STAFF_ADDED");
      expect(events).toHaveLength(1);
      expect(events[0]?.actorUserId).toBe(ownerA);
      expect(events[0]?.targetId).toBe(created.id);
      expect(events[0]?.metadata).toMatchObject({
        targetUserId: staffUser,
        role: "STAFF",
      });
    });

    it("settles concurrent duplicate adds to exactly one membership and one audit event", async () => {
      const target = await makeUser("staff-race");
      const email = `staff-race-${suffix}@example.com`;
      await registerEmail(email, target);
      const results = await Promise.allSettled([
        addOrganizationStaff(ownerA, { email, role: "STAFF" }),
        addOrganizationStaff(ownerA, { email, role: "TRAINER" }),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(
        (rejected[0] as PromiseRejectedResult).reason,
      ).toBeInstanceOf(StaffConflictError);

      const rows = await db.organizationMembership.findMany({
        where: { userId: target, organizationId: orgA },
      });
      expect(rows).toHaveLength(1);
      const events = await db.auditLog.findMany({
        where: {
          organizationId: orgA,
          event: "STAFF_ADDED",
          targetId: rows[0]?.id,
        },
      });
      expect(events).toHaveLength(1);
    });

    it("changes a role with an audit event; a no-op change writes neither", async () => {
      const target = await makeUser("staff-change");
      const email = `staff-change-${suffix}@example.com`;
      await registerEmail(email, target);
      const created = await addOrganizationStaff(ownerA, {
        email,
        role: "STAFF",
      });
      const changed = await changeOrganizationStaffRole(ownerA, {
        membershipId: created.id,
        role: "TRAINER",
      });
      expect(changed.role).toBe("TRAINER");
      const changeEvents = await auditEvents(orgA, "STAFF_ROLE_CHANGED");
      expect(changeEvents).toHaveLength(1);
      expect(changeEvents[0]?.metadata).toMatchObject({
        targetUserId: target,
        fromRole: "STAFF",
        toRole: "TRAINER",
      });

      await changeOrganizationStaffRole(ownerA, {
        membershipId: created.id,
        role: "TRAINER",
      });
      expect(await auditEvents(orgA, "STAFF_ROLE_CHANGED")).toHaveLength(1);
    });

    it("revokes access without deleting the User or their other-gym membership", async () => {
      const target = await makeUser("staff-revoke");
      const email = `staff-revoke-${suffix}@example.com`;
      await registerEmail(email, target);
      const inA = await addOrganizationStaff(ownerA, { email, role: "STAFF" });
      const inB = await addOrganizationStaff(ownerB, { email, role: "TRAINER" });

      await revokeOrganizationStaffAccess(ownerA, { membershipId: inA.id });

      expect(
        await db.organizationMembership.findUnique({
          where: { id: inA.id },
        }),
      ).toBeNull();
      // The other gym's membership and the global User survive.
      expect(
        await db.organizationMembership.findUnique({
          where: { id: inB.id },
        }),
      ).toMatchObject({ role: "TRAINER" });
      expect(await db.user.findUnique({ where: { id: target } })).not.toBeNull();
      const events = await auditEvents(orgA, "STAFF_ACCESS_REVOKED");
      expect(events).toHaveLength(1);
      expect(events[0]?.metadata).toMatchObject({
        targetUserId: target,
        role: "STAFF",
      });
    });

    it("treats another gym's membership as not found, changing nothing", async () => {
      const target = await makeUser("staff-xtenant");
      const email = `staff-xtenant-${suffix}@example.com`;
      await registerEmail(email, target);
      const inB = await addOrganizationStaff(ownerB, { email, role: "STAFF" });

      await expect(
        changeOrganizationStaffRole(ownerA, {
          membershipId: inB.id,
          role: "TRAINER",
        }),
      ).rejects.toBeInstanceOf(StaffNotFoundError);
      await expect(
        revokeOrganizationStaffAccess(ownerA, { membershipId: inB.id }),
      ).rejects.toBeInstanceOf(StaffNotFoundError);

      expect(
        await db.organizationMembership.findUnique({
          where: { id: inB.id },
        }),
      ).toMatchObject({ role: "STAFF" });
      // No audit event in Gym A references Gym B's membership.
      const stray = await db.auditLog.findMany({
        where: { organizationId: orgA, targetId: inB.id },
      });
      expect(stray).toHaveLength(0);
    });

    it("protects the OWNER row and ADMIN boundaries against the real database", async () => {
      const ownerMembership = await db.organizationMembership.findUnique({
        where: { userId_organizationId: { userId: ownerA, organizationId: orgA } },
      });
      await expect(
        changeOrganizationStaffRole(ownerA, {
          membershipId: ownerMembership!.id,
          role: "STAFF",
        }),
      ).rejects.toBeInstanceOf(StaffAuthorizationError);
      await expect(
        revokeOrganizationStaffAccess(ownerA, {
          membershipId: ownerMembership!.id,
        }),
      ).rejects.toBeInstanceOf(StaffAuthorizationError);
      expect(
        await db.organizationMembership.findUnique({
          where: { id: ownerMembership!.id },
        }),
      ).toMatchObject({ role: "OWNER" });

      // A real ADMIN cannot grant ADMIN.
      const adminUser = await makeUser("admin-1");
      const adminEmail = `admin-1-${suffix}@example.com`;
      await registerEmail(adminEmail, adminUser);
      await addOrganizationStaff(ownerA, { email: adminEmail, role: "ADMIN" });
      const other = await makeUser("staff-by-admin");
      const otherEmail = `staff-by-admin-${suffix}@example.com`;
      await registerEmail(otherEmail, other);
      await expect(
        addOrganizationStaff(adminUser, { email: otherEmail, role: "ADMIN" }),
      ).rejects.toBeInstanceOf(StaffAuthorizationError);
      const added = await addOrganizationStaff(adminUser, {
        email: otherEmail,
        role: "STAFF",
      });
      expect(added.role).toBe("STAFF");
    });

    it("excludes MEMBER memberships from the staff list", async () => {
      const plainMember = await makeUser("plain-member");
      await db.organizationMembership.create({
        data: { userId: plainMember, organizationId: orgA, role: "MEMBER" },
      });
      const staffUser = await makeUser("staff-listed");
      const email = `staff-listed-${suffix}@example.com`;
      await registerEmail(email, staffUser);
      await addOrganizationStaff(ownerA, { email, role: "TRAINER" });

      const list = await listOrganizationStaff(ownerA);
      const userIds = list.map((row) => row.userId);
      expect(userIds).toContain(staffUser);
      expect(userIds).toContain(ownerA);
      expect(userIds).not.toContain(plainMember);
      expect(list.every((row) => row.role !== "MEMBER")).toBe(true);
    });

    it("scopes a multi-gym manager to their primary (earliest) gym", async () => {
      // ownerA joins Gym B as ADMIN *after* founding Gym A, so Gym A
      // remains their primary membership and every staff operation must
      // keep targeting Gym A — Gym B staff must not leak into the list,
      // and adds must land in Gym A.
      await db.organizationMembership.create({
        data: { userId: ownerA, organizationId: orgB, role: "ADMIN" },
      });
      const bOnlyStaff = await makeUser("b-only-staff");
      const bEmail = `b-only-staff-${suffix}@example.com`;
      await registerEmail(bEmail, bOnlyStaff);
      await addOrganizationStaff(ownerB, { email: bEmail, role: "STAFF" });

      const listForA = await listOrganizationStaff(ownerA);
      expect(listForA.map((row) => row.userId)).not.toContain(bOnlyStaff);

      const aTarget = await makeUser("a-target");
      const aEmail = `a-target-${suffix}@example.com`;
      await registerEmail(aEmail, aTarget);
      const created = await addOrganizationStaff(ownerA, {
        email: aEmail,
        role: "STAFF",
      });
      expect(created.organizationId).toBe(orgA);
    });

    it("denies an add when the actor's own access is revoked mid-flight (during the Clerk lookup)", async () => {
      // A dedicated ADMIN actor whose membership the "concurrent"
      // transaction deletes while the add request is on its network
      // call. The mutation-boundary revalidation must deny the add:
      // no membership created, no audit event.
      const actor = await makeUser("admin-revoked-midflight");
      const actorEmail = `admin-revoked-midflight-${suffix}@example.com`;
      await registerEmail(actorEmail, actor);
      await addOrganizationStaff(ownerA, { email: actorEmail, role: "ADMIN" });

      const target = await makeUser("midflight-target");
      const targetEmail = `midflight-target-${suffix}@example.com`;
      await registerEmail(targetEmail, target);

      directoryHookRef.current = async () => {
        await db.organizationMembership.deleteMany({
          where: { userId: actor, organizationId: orgA },
        });
      };
      try {
        await expect(
          addOrganizationStaff(actor, { email: targetEmail, role: "STAFF" }),
        ).rejects.toBeInstanceOf(StaffAuthorizationError);
      } finally {
        directoryHookRef.current = null;
      }
      expect(
        await db.organizationMembership.findFirst({
          where: { userId: target, organizationId: orgA },
        }),
      ).toBeNull();
      const strayAudits = await db.auditLog.findMany({
        where: {
          organizationId: orgA,
          event: "STAFF_ADDED",
          actorUserId: actor,
        },
      });
      expect(strayAudits).toHaveLength(0);
    });

    it("denies an add when the actor is downgraded below manager mid-flight", async () => {
      const actor = await makeUser("admin-downgraded-midflight");
      const actorEmail = `admin-downgraded-midflight-${suffix}@example.com`;
      await registerEmail(actorEmail, actor);
      await addOrganizationStaff(ownerA, { email: actorEmail, role: "ADMIN" });

      const target = await makeUser("downgrade-target");
      const targetEmail = `downgrade-target-${suffix}@example.com`;
      await registerEmail(targetEmail, target);

      directoryHookRef.current = async () => {
        await db.organizationMembership.updateMany({
          where: { userId: actor, organizationId: orgA },
          data: { role: "STAFF" },
        });
      };
      try {
        await expect(
          addOrganizationStaff(actor, { email: targetEmail, role: "STAFF" }),
        ).rejects.toBeInstanceOf(StaffAuthorizationError);
      } finally {
        directoryHookRef.current = null;
      }
      expect(
        await db.organizationMembership.findFirst({
          where: { userId: target, organizationId: orgA },
        }),
      ).toBeNull();
    });

    it("serializes a manager's change against the owner revoking that manager", async () => {
      // ADMIN changes a STAFF member while OWNER revokes the ADMIN.
      // Either serialization is acceptable — the change completes while
      // the admin is still authorized, or it is denied after the
      // revocation — but the end state and the audit trail must agree.
      const admin = await makeUser("admin-racing");
      const adminEmail = `admin-racing-${suffix}@example.com`;
      await registerEmail(adminEmail, admin);
      const adminMembership = await addOrganizationStaff(ownerA, {
        email: adminEmail,
        role: "ADMIN",
      });
      const target = await makeUser("race-target");
      const targetEmail = `race-target-${suffix}@example.com`;
      await registerEmail(targetEmail, target);
      const targetMembership = await addOrganizationStaff(ownerA, {
        email: targetEmail,
        role: "STAFF",
      });

      const [changeResult] = await Promise.allSettled([
        changeOrganizationStaffRole(admin, {
          membershipId: targetMembership.id,
          role: "TRAINER",
        }),
        revokeOrganizationStaffAccess(ownerA, {
          membershipId: adminMembership.id,
        }),
      ]);

      // The owner's revocation always lands eventually.
      expect(
        await db.organizationMembership.findUnique({
          where: { id: adminMembership.id },
        }),
      ).toBeNull();
      const revokeEvents = await db.auditLog.findMany({
        where: {
          organizationId: orgA,
          event: "STAFF_ACCESS_REVOKED",
          targetId: adminMembership.id,
        },
      });
      expect(revokeEvents).toHaveLength(1);

      const changeEvents = await db.auditLog.findMany({
        where: {
          organizationId: orgA,
          event: "STAFF_ROLE_CHANGED",
          targetId: targetMembership.id,
        },
      });
      const targetRow = await db.organizationMembership.findUnique({
        where: { id: targetMembership.id },
      });
      if (changeResult.status === "fulfilled") {
        // Serialized BEFORE the revocation: mutation + exactly one audit.
        expect(changeEvents).toHaveLength(1);
        expect(targetRow?.role).toBe("TRAINER");
      } else {
        // Serialized AFTER the revocation: denied, nothing written.
        expect(changeResult.reason).toBeInstanceOf(StaffAuthorizationError);
        expect(changeEvents).toHaveLength(0);
        expect(targetRow?.role).toBe("STAFF");
      }
    });

    it("serializes a concurrent change and revoke into one consistent outcome", async () => {
      const target = await makeUser("staff-clash");
      const email = `staff-clash-${suffix}@example.com`;
      await registerEmail(email, target);
      const created = await addOrganizationStaff(ownerA, {
        email,
        role: "STAFF",
      });
      const results = await Promise.allSettled([
        changeOrganizationStaffRole(ownerA, {
          membershipId: created.id,
          role: "TRAINER",
        }),
        revokeOrganizationStaffAccess(ownerA, { membershipId: created.id }),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const row = await db.organizationMembership.findUnique({
        where: { id: created.id },
      });
      const changeEvents = await db.auditLog.findMany({
        where: { organizationId: orgA, event: "STAFF_ROLE_CHANGED", targetId: created.id },
      });
      const revokeEvents = await db.auditLog.findMany({
        where: {
          organizationId: orgA,
          event: "STAFF_ACCESS_REVOKED",
          targetId: created.id,
        },
      });
      // Every fulfilled operation wrote exactly its own audit event, and
      // no rejected operation wrote one.
      expect(fulfilled).toHaveLength(changeEvents.length + revokeEvents.length);
      expect(changeEvents.length).toBeLessThanOrEqual(1);
      expect(revokeEvents.length).toBeLessThanOrEqual(1);
      // Terminal state is always a valid serialization of the two
      // operations: the row is either gone (revoke landed last, with its
      // event) or survives as TRAINER (change landed, revoke rejected).
      // It never survives as STAFF with a fulfilled mutation lost.
      if (row === null) {
        expect(revokeEvents).toHaveLength(1);
      } else {
        expect(row.role).toBe("TRAINER");
        expect(changeEvents).toHaveLength(1);
        expect(revokeEvents).toHaveLength(0);
      }
    });
  },
);
