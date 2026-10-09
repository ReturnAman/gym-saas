import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

import { db } from "@/lib/server/db";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const MIGRATION_SQL_PATH = path.join(
  repoRoot,
  "prisma/migrations/20261010103000_add_attendance_sessions/migration.sql",
);
const SCHEMA_PATH = path.join(repoRoot, "prisma/schema.prisma");

/**
 * Tenant integrity for AttendanceSession.
 *
 * A session carries organization_id + member_id, so the database itself
 * must reject a session whose member belongs to a different organization
 * — the same composite-foreign-key pattern Membership and Payment use.
 * And the one-open-session-per-member rule must be a database guarantee
 * (partial unique index), not just an application pre-check: two racing
 * check-ins cannot both succeed.
 */
describe("attendance tenant integrity", () => {
  describe("migration and schema coherence", () => {
    const migrationSql = readFileSync(MIGRATION_SQL_PATH, "utf8");
    const schema = readFileSync(SCHEMA_PATH, "utf8");
    const model = schema.match(/model AttendanceSession \{([\s\S]*?)\n\}/);
    const createTable = migrationSql.match(
      /CREATE TABLE "attendance_sessions" \(([\s\S]*?)\);/,
    );

    it("creates the attendance source enum with MANUAL and QR", () => {
      expect(migrationSql).toMatch(
        /CREATE TYPE "AttendanceSource" AS ENUM \('MANUAL', 'QR'\)/,
      );
      expect(schema).toMatch(/enum AttendanceSource \{[\s\S]*?MANUAL[\s\S]*?QR/);
    });

    it("creates the attendance_sessions table with nullable check_out_at and no status column", () => {
      expect(createTable).not.toBeNull();
      const body = createTable![1];
      expect(body).toMatch(/"check_in_at" TIMESTAMPTZ\(6\) NOT NULL/);
      expect(body).toMatch(/"check_out_at" TIMESTAMPTZ\(6\),/);
      expect(body).not.toMatch(/"status"/);
      expect(model).not.toBeNull();
      expect(model![1]).not.toMatch(/^\s+status\s/m);
    });

    it("creates a composite foreign key attendance_sessions(organization_id, member_id) → members(organization_id, id)", () => {
      expect(migrationSql).toMatch(
        /FOREIGN KEY\s*\(\s*"organization_id"\s*,\s*"member_id"\s*\)\s*REFERENCES\s*"members"\s*\(\s*"organization_id"\s*,\s*"id"\s*\)/,
      );
      expect(schema).toMatch(
        /member\s+Member\s+@relation\(fields:\s*\[organizationId,\s*memberId\],\s*references:\s*\[organizationId,\s*id\]/,
      );
    });

    it("backs the model with the (organization_id, id) composite unique", () => {
      expect(migrationSql).toMatch(
        /CREATE UNIQUE INDEX "attendance_sessions_organization_id_id_key" ON "attendance_sessions"\("organization_id", "id"\)/,
      );
      expect(model![1]).toMatch(/@@unique\(\[organizationId,\s*id\]\)/);
    });

    it("restricts deletion of the check-in actor", () => {
      expect(migrationSql).toMatch(
        /FOREIGN KEY \("checked_in_by"\) REFERENCES "users"\("id"\) ON DELETE RESTRICT/,
      );
      expect(schema).toMatch(
        /checkedInByUser User\s+@relation\("AttendanceCheckedInBy", fields: \[checkedInBy\], references: \[id\], onDelete: Restrict\)/,
      );
    });

    it("creates the partial unique index for one open session per member", () => {
      expect(migrationSql).toMatch(
        /CREATE UNIQUE INDEX "attendance_sessions_one_open_per_member" ON "attendance_sessions"\("organization_id", "member_id"\) WHERE "check_out_at" IS NULL/,
      );
      // The migration must warn that the partial index is not expressible
      // in the Prisma schema and has to survive regeneration.
      expect(migrationSql).toMatch(/PARTIAL UNIQUE INDEX/);
      expect(migrationSql).toMatch(/must be preserved/);
    });
  });

  /**
   * True persistence proof against a real PostgreSQL database.
   *
   * No database is available in this sandbox or in CI, so this suite is
   * skipped unless explicitly enabled:
   *
   *   RUN_DB_TESTS=true DATABASE_URL=postgresql://... npx vitest run \
   *     src/lib/server/__tests__/attendance-tenant-integrity.test.ts
   *
   * Run it after `prisma migrate deploy` applies the migration above.
   */
  describe.skipIf(process.env.RUN_DB_TESTS !== "true")(
    "database enforcement",
    () => {
      const suffix = crypto.randomUUID();
      const createdOrgIds: string[] = [];
      let actorId = "";

      beforeAll(async () => {
        await db.$queryRaw`SELECT 1`;
        const actor = await db.user.create({
          data: { clerkUserId: `integrity-actor-${suffix}` },
          select: { id: true },
        });
        actorId = actor.id;
      });

      afterAll(async () => {
        if (createdOrgIds.length > 0) {
          await db.organization.deleteMany({
            where: { id: { in: createdOrgIds } },
          });
        }
        if (actorId) {
          await db.user.deleteMany({ where: { id: actorId } });
        }
        await db.$disconnect();
      });

      async function seedOrg(name: string) {
        const org = await db.organization.create({
          data: { name },
          select: { id: true },
        });
        createdOrgIds.push(org.id);
        const member = await db.member.create({
          data: {
            organizationId: org.id,
            name: "Integrity Member",
            phoneNumber: "9000000021",
          },
          select: { id: true },
        });
        const membership = await db.membership.create({
          data: {
            organizationId: org.id,
            memberId: member.id,
            plan: "MONTHLY",
            startDate: new Date(Date.UTC(2026, 0, 1)),
            expiryDate: new Date(Date.UTC(2027, 0, 1)),
            fee: new Prisma.Decimal("1000"),
          },
          select: { id: true },
        });
        return { org, member, membership };
      }

      it("persists a session whose organization matches its member", async () => {
        const { org, member } = await seedOrg(`Attendance Org ${suffix}`);
        const session = await db.attendanceSession.create({
          data: {
            organizationId: org.id,
            memberId: member.id,
            checkedInBy: actorId,
            source: "MANUAL",
            checkInAt: new Date(),
          },
          select: { id: true, checkOutAt: true },
        });
        expect(session.id).toBeTruthy();
        expect(session.checkOutAt).toBeNull();
      });

      it("rejects a session whose member belongs to another organization", async () => {
        const a = await seedOrg(`Attendance Org A ${suffix}`);
        const b = await seedOrg(`Attendance Org B ${suffix}`);
        const error = await db.attendanceSession
          .create({
            data: {
              // Organization B claims a member of Organization A.
              organizationId: b.org.id,
              memberId: a.member.id,
              checkedInBy: actorId,
              source: "MANUAL",
              checkInAt: new Date(),
            },
          })
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
        expect((error as { code?: string }).code).toBe("P2003");
      });

      it("rejects a second OPEN session for the same member, then allows one after check-out", async () => {
        const { org, member } = await seedOrg(`Attendance Open Org ${suffix}`);
        const first = await db.attendanceSession.create({
          data: {
            organizationId: org.id,
            memberId: member.id,
            checkedInBy: actorId,
            source: "MANUAL",
            checkInAt: new Date(),
          },
          select: { id: true },
        });

        // A second open session for the same (organization, member) hits
        // the partial unique index.
        const error = await db.attendanceSession
          .create({
            data: {
              organizationId: org.id,
              memberId: member.id,
              checkedInBy: actorId,
              source: "MANUAL",
              checkInAt: new Date(),
            },
          })
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
        expect((error as { code?: string }).code).toBe("P2002");

        // Closing the first session frees the member to check in again.
        await db.attendanceSession.update({
          where: { id: first.id },
          data: { checkOutAt: new Date() },
        });
        const second = await db.attendanceSession.create({
          data: {
            organizationId: org.id,
            memberId: member.id,
            checkedInBy: actorId,
            source: "MANUAL",
            checkInAt: new Date(),
          },
          select: { id: true },
        });
        expect(second.id).toBeTruthy();
        expect(second.id).not.toBe(first.id);
      });
    },
  );
});
