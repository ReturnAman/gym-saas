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
  "prisma/migrations/20261001020000_add_members_and_memberships/migration.sql",
);
const SCHEMA_PATH = path.join(repoRoot, "prisma/schema.prisma");

/**
 * Tenant integrity between Member and Membership.
 *
 * A membership carries both organization_id and member_id, so the database
 * itself must reject a membership whose organization does not match its
 * member's organization — application code alone is not the enforcement
 * point. The mechanism is a composite unique constraint on
 * members(organization_id, id) backing a composite foreign key
 * memberships(organization_id, member_id) → members(organization_id, id).
 */
describe("membership/member tenant integrity", () => {
  describe("migration and schema coherence", () => {
    const migrationSql = readFileSync(MIGRATION_SQL_PATH, "utf8");
    const schema = readFileSync(SCHEMA_PATH, "utf8");

    it("creates no paid_amount column on memberships", () => {
      // Assert on the CREATE TABLE body specifically: comments elsewhere in
      // the migration may discuss why the column does not exist.
      const createTable = migrationSql.match(
        /CREATE TABLE "memberships" \(([\s\S]*?)\);/,
      );
      expect(createTable).not.toBeNull();
      expect(createTable![1]).not.toMatch(/"paid_amount"/);
    });

    it("creates a composite unique constraint on members(organization_id, id)", () => {
      expect(migrationSql).toMatch(
        /CONSTRAINT\s+"members_organization_id_id_key"\s+UNIQUE\s*\(\s*"organization_id"\s*,\s*"id"\s*\)/,
      );
      expect(schema).toMatch(/@@unique\(\[organizationId,\s*id\]\)/);
    });

    it("creates a composite foreign key memberships(organization_id, member_id) → members(organization_id, id)", () => {
      expect(migrationSql).toMatch(
        /FOREIGN KEY\s*\(\s*"organization_id"\s*,\s*"member_id"\s*\)\s*REFERENCES\s*"members"\s*\(\s*"organization_id"\s*,\s*"id"\s*\)/,
      );
      expect(schema).toMatch(
        /@relation\(fields:\s*\[organizationId,\s*memberId\],\s*references:\s*\[organizationId,\s*id\]/,
      );
    });
  });

  /**
   * True persistence proof against a real PostgreSQL database.
   *
   * No database is available in this sandbox or in CI (both use placeholder
   * connection strings), so this suite is skipped unless explicitly enabled:
   *
   *   RUN_DB_TESTS=true DATABASE_URL=postgresql://... npx vitest run \
   *     src/lib/server/__tests__/membership-tenant-integrity.test.ts
   *
   * Run it after `prisma migrate dev` applies the migration above.
   */
  describe.skipIf(process.env.RUN_DB_TESTS !== "true")(
    "database enforcement",
    () => {
      const orgNameA = `Integrity Test Org A ${crypto.randomUUID()}`;
      const orgNameB = `Integrity Test Org B ${crypto.randomUUID()}`;
      const createdOrgIds: string[] = [];

      beforeAll(async () => {
        // Fail fast with a clear error if the database is not reachable,
        // rather than timing out inside the individual tests.
        await db.$queryRaw`SELECT 1`;
      });

      afterAll(async () => {
        // Organization delete cascades to members and memberships.
        if (createdOrgIds.length > 0) {
          await db.organization.deleteMany({
            where: { id: { in: createdOrgIds } },
          });
        }
        await db.$disconnect();
      });

      it("persists a membership whose organization matches its member's organization", async () => {
        const orgA = await db.organization.create({
          data: { name: orgNameA },
          select: { id: true },
        });
        createdOrgIds.push(orgA.id);

        const member = await db.member.create({
          data: {
            organizationId: orgA.id,
            name: "Integrity Member",
            phoneNumber: "9000000001",
          },
          select: { id: true },
        });

        const membership = await db.membership.create({
          data: {
            organizationId: orgA.id,
            memberId: member.id,
            plan: "MONTHLY",
            startDate: new Date(Date.UTC(2026, 0, 1)),
            expiryDate: new Date(Date.UTC(2026, 1, 1)),
            fee: new Prisma.Decimal("1000"),
          },
          select: { id: true, organizationId: true, memberId: true },
        });

        expect(membership.organizationId).toBe(orgA.id);
        expect(membership.memberId).toBe(member.id);
      });

      it("rejects a membership whose organization does not match its member's organization", async () => {
        const orgA = await db.organization.create({
          data: { name: `${orgNameA}-mismatch` },
          select: { id: true },
        });
        const orgB = await db.organization.create({
          data: { name: orgNameB },
          select: { id: true },
        });
        createdOrgIds.push(orgA.id, orgB.id);

        const memberOfA = await db.member.create({
          data: {
            organizationId: orgA.id,
            name: "Integrity Member B",
            phoneNumber: "9000000002",
          },
          select: { id: true },
        });

        const error = await db.membership
          .create({
            data: {
              // Organization B claims a member that belongs to Organization A.
              organizationId: orgB.id,
              memberId: memberOfA.id,
              plan: "MONTHLY",
              startDate: new Date(Date.UTC(2026, 0, 1)),
              expiryDate: new Date(Date.UTC(2026, 1, 1)),
              fee: new Prisma.Decimal("1000"),
            },
          })
          .then(
            () => null,
            (e: unknown) => e,
          );

        expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
        // P2003: foreign key constraint failed on the composite
        // (organization_id, member_id) reference.
        expect((error as { code?: string }).code).toBe("P2003");
      });
    },
  );
});
