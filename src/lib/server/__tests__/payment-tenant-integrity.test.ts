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
  "prisma/migrations/20261008230000_add_payments_and_audit_log/migration.sql",
);
const SCHEMA_PATH = path.join(repoRoot, "prisma/schema.prisma");

/**
 * Tenant integrity for Payment (and the audit foundation).
 *
 * A payment carries organization_id, member_id and membership_id, so the
 * database itself must reject a payment whose member or membership belongs
 * to a different organization — the same composite-foreign-key pattern
 * Membership already uses against Member. Financial state must also never
 * be persisted as a balance: no paid_amount column may appear anywhere.
 */
describe("payment tenant integrity", () => {
  describe("migration and schema coherence", () => {
    const migrationSql = readFileSync(MIGRATION_SQL_PATH, "utf8");
    const schema = readFileSync(SCHEMA_PATH, "utf8");

    it("creates no paid_amount column anywhere", () => {
      const createTables = migrationSql.match(/CREATE TABLE "(\w+)" \(([\s\S]*?)\);/g);
      expect(createTables).not.toBeNull();
      for (const table of createTables ?? []) {
        expect(table).not.toMatch(/"paid_amount"/);
      }
    });

    it("creates the memberships(organization_id, id) unique backing the payment membership key", () => {
      expect(migrationSql).toMatch(
        /CONSTRAINT\s+"memberships_organization_id_id_key"\s+UNIQUE\s*\(\s*"organization_id"\s*,\s*"id"\s*\)/,
      );
      expect(schema).toMatch(/@@unique\(\[organizationId,\s*id\]\)/);
    });

    it("creates a composite foreign key payments(organization_id, member_id) → members(organization_id, id)", () => {
      expect(migrationSql).toMatch(
        /FOREIGN KEY\s*\(\s*"organization_id"\s*,\s*"member_id"\s*\)\s*REFERENCES\s*"members"\s*\(\s*"organization_id"\s*,\s*"id"\s*\)/,
      );
      expect(schema).toMatch(
        /member\s+Member\s+@relation\(fields:\s*\[organizationId,\s*memberId\],\s*references:\s*\[organizationId,\s*id\]/,
      );
    });

    it("creates a composite foreign key payments(organization_id, membership_id) → memberships(organization_id, id)", () => {
      expect(migrationSql).toMatch(
        /FOREIGN KEY\s*\(\s*"organization_id"\s*,\s*"membership_id"\s*\)\s*REFERENCES\s*"memberships"\s*\(\s*"organization_id"\s*,\s*"id"\s*\)/,
      );
      expect(schema).toMatch(
        /membership\s+Membership\s+@relation\(fields:\s*\[organizationId,\s*membershipId\],\s*references:\s*\[organizationId,\s*id\]/,
      );
    });

    it("creates the payments and audit_logs tables with exact money types", () => {
      expect(migrationSql).toMatch(/CREATE TABLE "payments"/);
      expect(migrationSql).toMatch(/"amount"\s+DECIMAL\(12,2\)/);
      expect(migrationSql).toMatch(/CREATE TABLE "audit_logs"/);
    });
  });

  /**
   * True persistence proof against a real PostgreSQL database.
   *
   * No database is available in this sandbox or in CI, so this suite is
   * skipped unless explicitly enabled:
   *
   *   RUN_DB_TESTS=true DATABASE_URL=postgresql://... npx vitest run \
   *     src/lib/server/__tests__/payment-tenant-integrity.test.ts
   *
   * Run it after `prisma migrate dev` applies the migration above.
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
            phoneNumber: "9000000011",
          },
          select: { id: true },
        });
        const membership = await db.membership.create({
          data: {
            organizationId: org.id,
            memberId: member.id,
            plan: "MONTHLY",
            startDate: new Date(Date.UTC(2026, 0, 1)),
            expiryDate: new Date(Date.UTC(2026, 1, 1)),
            fee: new Prisma.Decimal("1000"),
          },
          select: { id: true },
        });
        return { org, member, membership };
      }

      it("persists a payment + audit event whose organization matches its member and membership", async () => {
        const { org, member, membership } = await seedOrg(`Payment Org ${suffix}`);
        const payment = await db.payment.create({
          data: {
            organizationId: org.id,
            memberId: member.id,
            membershipId: membership.id,
            amount: new Prisma.Decimal("500"),
            paymentMethod: "UPI",
            confirmedAt: new Date(),
            confirmedBy: actorId,
          },
          select: { id: true },
        });
        const audit = await db.auditLog.create({
          data: {
            organizationId: org.id,
            actorUserId: actorId,
            event: "PAYMENT_CONFIRMED",
            targetType: "Payment",
            targetId: payment.id,
            metadata: { amountPaise: 50_000 },
          },
          select: { id: true },
        });
        expect(payment.id).toBeTruthy();
        expect(audit.id).toBeTruthy();
      });

      it("rejects a payment whose member belongs to another organization", async () => {
        const a = await seedOrg(`Payment Org A ${suffix}`);
        const b = await seedOrg(`Payment Org B ${suffix}`);
        const error = await db.payment
          .create({
            data: {
              // Organization B claims a member + membership of Organization A.
              organizationId: b.org.id,
              memberId: a.member.id,
              membershipId: a.membership.id,
              amount: new Prisma.Decimal("500"),
              paymentMethod: "CASH",
              confirmedAt: new Date(),
              confirmedBy: actorId,
            },
          })
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
        expect((error as { code?: string }).code).toBe("P2003");
      });
    },
  );
});
