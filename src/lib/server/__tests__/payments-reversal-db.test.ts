import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

import { db } from "@/lib/server/db";
import {
  AUDIT_EVENT_PAYMENT_CONFIRMED,
  AUDIT_EVENT_PAYMENT_REVERSED,
} from "@/lib/server/audit";
import {
  PaymentAuthorizationError,
  PaymentIdempotencyConflictError,
  PaymentNotFoundError,
  PaymentReversalExceedsError,
  listPaymentsForMembership,
  listReversalsForMembership,
  recordPayment,
  reversePayment,
  sumConfirmedPaymentsByMembership,
} from "@/lib/server/payments";
import { getMemberDetail } from "@/lib/server/members";
import {
  confirmPaymentClaim,
  getOwnMembershipSummary,
  listOwnPaymentReversals,
  type MemberClaimScope,
} from "@/lib/server/payment-claims";

/**
 * Payment reversals against a real PostgreSQL database.
 *
 * A reversal is an append-only ledger correction: the original Payment
 * row never changes, totals derive NET (payments − reversals) through
 * the one aggregation funnel, the cumulative per-payment invariant is
 * enforced by locking the payment row inside the transaction, and the
 * reversal + PAYMENT_REVERSED audit event commit atomically.
 */

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const MIGRATION_SQL_PATH = path.join(
  repoRoot,
  "prisma/migrations/20261021120000_add_payment_reversals/migration.sql",
);
const SCHEMA_PATH = path.join(repoRoot, "prisma/schema.prisma");

describe("payment reversals — schema coherence", () => {
  const migrationSql = readFileSync(MIGRATION_SQL_PATH, "utf8");
  const schema = readFileSync(SCHEMA_PATH, "utf8");

  it("creates the reason enum with exactly the six approved values", () => {
    expect(migrationSql).toMatch(
      /CREATE TYPE "PaymentReversalReason" AS ENUM \('DUPLICATE_ENTRY', 'WRONG_MEMBER', 'WRONG_AMOUNT', 'PAYMENT_FAILED', 'REFUNDED_TO_MEMBER', 'OTHER'\)/,
    );
    expect(schema).toMatch(
      /enum PaymentReversalReason \{\s+DUPLICATE_ENTRY\s+WRONG_MEMBER\s+WRONG_AMOUNT\s+PAYMENT_FAILED\s+REFUNDED_TO_MEMBER\s+OTHER\s+\}/,
    );
  });

  it("creates payment_reversals with tenant-composite foreign keys and a Restrict payment link", () => {
    expect(migrationSql).toMatch(/CREATE TABLE "payment_reversals"/);
    expect(migrationSql).toMatch(
      /FOREIGN KEY \("organization_id", "payment_id"\) REFERENCES "payments"\("organization_id", "id"\) ON DELETE RESTRICT/,
    );
    expect(migrationSql).toMatch(
      /FOREIGN KEY \("organization_id", "member_id"\) REFERENCES "members"\("organization_id", "id"\) ON DELETE CASCADE/,
    );
    expect(migrationSql).toMatch(
      /FOREIGN KEY \("organization_id", "membership_id"\) REFERENCES "memberships"\("organization_id", "id"\) ON DELETE CASCADE/,
    );
    expect(schema).toMatch(
      /payment\s+Payment\s+@relation\(fields: \[organizationId, paymentId\], references: \[organizationId, id\], onDelete: Restrict\)/,
    );
  });

  it("adds the payments composite unique and the organization-scoped idempotency unique", () => {
    expect(migrationSql).toMatch(
      /CREATE UNIQUE INDEX "payments_organization_id_id_key" ON "payments"\("organization_id", "id"\)/,
    );
    expect(migrationSql).toMatch(
      /CREATE UNIQUE INDEX "payment_reversals_organization_id_idempotency_key_key" ON "payment_reversals"\("organization_id", "idempotency_key"\)/,
    );
    expect(schema).toMatch(/@@unique\(\[organizationId, idempotencyKey\]\)/);
  });

  it("keeps the ledger append-only: positive Decimal(12,2) amounts and no updated_at", () => {
    expect(migrationSql).toMatch(/"amount" DECIMAL\(12,2\) NOT NULL/);
    const tableBlock = migrationSql.slice(
      migrationSql.indexOf('CREATE TABLE "payment_reversals"'),
      migrationSql.indexOf('CREATE INDEX "payment_reversals_organization_id_idx"'),
    );
    expect(tableBlock).not.toContain("updated_at");
  });
});

describe.skipIf(process.env.RUN_DB_TESTS !== "true")(
  "payment reversals — database enforcement",
  () => {
    const suffix = crypto.randomUUID();
    const createdOrgIds: string[] = [];
    const createdUserIds: string[] = [];

    beforeAll(async () => {
      await db.$queryRaw`SELECT 1`;
    });

    afterAll(async () => {
      if (createdOrgIds.length > 0) {
        // Reversals first: the Restrict payment FK must never block
        // cleanup ordering.
        await db.paymentReversal.deleteMany({
          where: { organizationId: { in: createdOrgIds } },
        });
        await db.organization.deleteMany({
          where: { id: { in: createdOrgIds } },
        });
      }
      if (createdUserIds.length > 0) {
        await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
      }
      await db.$disconnect();
    });

    async function seedGym(tag: string) {
      const org = await db.organization.create({
        data: { name: `Reversal Gym ${tag} ${suffix}` },
        select: { id: true },
      });
      createdOrgIds.push(org.id);
      const owner = await db.user.create({
        data: { clerkUserId: `rev-owner-${tag}-${suffix}` },
        select: { id: true },
      });
      createdUserIds.push(owner.id);
      await db.organizationMembership.create({
        data: { userId: owner.id, organizationId: org.id, role: "OWNER" },
      });
      const member = await db.member.create({
        data: {
          organizationId: org.id,
          name: "Reversal Member",
          phoneNumber: "9000000031",
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
          fee: new Prisma.Decimal("6000"),
        },
        select: { id: true },
      });
      return { org, owner, member, membership };
    }

    async function seedStaff(
      gym: Awaited<ReturnType<typeof seedGym>>,
      tag: string,
      role: "ADMIN" | "STAFF" | "TRAINER" | "MEMBER",
    ) {
      const user = await db.user.create({
        data: { clerkUserId: `rev-${tag}-${suffix}` },
        select: { id: true },
      });
      createdUserIds.push(user.id);
      await db.organizationMembership.create({
        data: { userId: user.id, organizationId: gym.org.id, role },
      });
      return user;
    }

    async function pay(
      gym: Awaited<ReturnType<typeof seedGym>>,
      amount: string,
    ): Promise<string> {
      const { paymentId } = await recordPayment(gym.owner.id, gym.member.id, {
        amount,
        paymentMethod: "UPI",
        reference: "",
      });
      return paymentId;
    }

    async function reversalCount(orgId: string) {
      return db.paymentReversal.count({ where: { organizationId: orgId } });
    }

    async function auditCount(orgId: string, event: string, targetId: string) {
      return db.auditLog.count({
        where: { organizationId: orgId, event, targetId },
      });
    }

    async function netPaid(gym: Awaited<ReturnType<typeof seedGym>>) {
      const sums = await sumConfirmedPaymentsByMembership(gym.org.id, [
        gym.membership.id,
      ]);
      return sums.get(gym.membership.id) ?? 0;
    }

    const FULL = { amount: "6000", reason: "OTHER", explanation: "" };

    it("full reversal by OWNER: net paid zero, correct outstanding/status, original row untouched", async () => {
      const gym = await seedGym("full");
      const paymentId = await pay(gym, "6000");
      const before = await db.payment.findUniqueOrThrow({
        where: { id: paymentId },
      });
      const membershipBefore = await db.membership.findUniqueOrThrow({
        where: { id: gym.membership.id },
      });

      const { reversalId } = await reversePayment(gym.owner.id, paymentId, {
        amount: "6000",
        reason: "DUPLICATE_ENTRY",
        explanation: "Recorded twice at the desk",
      });
      expect(reversalId).toBeTruthy();

      const reversal = await db.paymentReversal.findUniqueOrThrow({
        where: { id: reversalId },
      });
      expect(reversal).toMatchObject({
        organizationId: gym.org.id,
        paymentId,
        memberId: gym.member.id,
        membershipId: gym.membership.id,
        reason: "DUPLICATE_ENTRY",
        explanation: "Recorded twice at the desk",
        reversedBy: gym.owner.id,
      });
      expect(reversal.amount.toString()).toBe("6000");

      expect(await netPaid(gym)).toBe(0);
      const detail = await getMemberDetail(gym.owner.id, gym.member.id);
      expect(detail?.membership).toMatchObject({
        paidPaise: 0,
        outstandingPaise: 600_000,
        paymentStatus: "UNPAID",
      });

      // The original payment row is byte-identical, updatedAt included.
      const after = await db.payment.findUniqueOrThrow({
        where: { id: paymentId },
      });
      expect(after).toEqual(before);
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
      // Membership dates and fee are never a reversal side effect.
      const membershipAfter = await db.membership.findUniqueOrThrow({
        where: { id: gym.membership.id },
      });
      expect(membershipAfter).toEqual(membershipBefore);

      expect(
        await auditCount(gym.org.id, AUDIT_EVENT_PAYMENT_REVERSED, paymentId),
      ).toBe(1);
      const audit = await db.auditLog.findFirstOrThrow({
        where: {
          organizationId: gym.org.id,
          event: AUDIT_EVENT_PAYMENT_REVERSED,
          targetId: paymentId,
        },
      });
      expect(audit.metadata).toMatchObject({
        reversalId,
        amountPaise: 600_000,
        reason: "DUPLICATE_ENTRY",
      });
      expect(audit.metadata).not.toHaveProperty("explanation");
    });

    it("partial reversals by ADMIN accumulate against the remaining amount", async () => {
      const gym = await seedGym("partial");
      const admin = await seedStaff(gym, "admin", "ADMIN");
      const paymentId = await pay(gym, "6000");

      await reversePayment(admin.id, paymentId, {
        amount: "1500",
        reason: "WRONG_AMOUNT",
        explanation: "",
      });
      expect(await netPaid(gym)).toBe(450_000);
      let detail = await getMemberDetail(gym.owner.id, gym.member.id);
      expect(detail?.membership).toMatchObject({
        paidPaise: 450_000,
        outstandingPaise: 150_000,
        paymentStatus: "PARTIALLY_PAID",
      });

      await reversePayment(admin.id, paymentId, {
        amount: "4500",
        reason: "WRONG_AMOUNT",
        explanation: "",
      });
      expect(await netPaid(gym)).toBe(0);
      detail = await getMemberDetail(gym.owner.id, gym.member.id);
      expect(detail?.membership?.paymentStatus).toBe("UNPAID");
    });

    it("rejects over-reversal — in one call and past the remaining amount — writing nothing", async () => {
      const gym = await seedGym("over");
      const paymentId = await pay(gym, "6000");

      await expect(
        reversePayment(gym.owner.id, paymentId, {
          amount: "6000.01",
          reason: "OTHER",
          explanation: "",
        }),
      ).rejects.toMatchObject({
        name: "PaymentReversalExceedsError",
        remainingPaise: 600_000,
      });

      await reversePayment(gym.owner.id, paymentId, {
        amount: "5000",
        reason: "OTHER",
        explanation: "",
      });
      await expect(
        reversePayment(gym.owner.id, paymentId, {
          amount: "1000.01",
          reason: "OTHER",
          explanation: "",
        }),
      ).rejects.toMatchObject({
        name: "PaymentReversalExceedsError",
        remainingPaise: 100_000,
      });

      expect(await reversalCount(gym.org.id)).toBe(1);
      expect(
        await auditCount(gym.org.id, AUDIT_EVENT_PAYMENT_REVERSED, paymentId),
      ).toBe(1);
    });

    it("role matrix: STAFF, TRAINER and MEMBER cannot reverse, and a demotion ends the ability", async () => {
      const gym = await seedGym("roles");
      const staff = await seedStaff(gym, "staff", "STAFF");
      const trainer = await seedStaff(gym, "trainer", "TRAINER");
      const memberRole = await seedStaff(gym, "memberrole", "MEMBER");
      const paymentId = await pay(gym, "6000");

      for (const actor of [staff, trainer, memberRole]) {
        await expect(
          reversePayment(actor.id, paymentId, FULL),
        ).rejects.toBeInstanceOf(PaymentAuthorizationError);
      }
      expect(await reversalCount(gym.org.id)).toBe(0);

      const admin = await seedStaff(gym, "demoted", "ADMIN");
      await reversePayment(admin.id, paymentId, {
        amount: "1000",
        reason: "OTHER",
        explanation: "",
      });
      await db.organizationMembership.updateMany({
        where: { userId: admin.id, organizationId: gym.org.id },
        data: { role: "STAFF" },
      });
      await expect(
        reversePayment(admin.id, paymentId, {
          amount: "1000",
          reason: "OTHER",
          explanation: "",
        }),
      ).rejects.toBeInstanceOf(PaymentAuthorizationError);
      expect(await reversalCount(gym.org.id)).toBe(1);
    });

    it("concurrent reversals cannot cumulatively exceed the payment amount", async () => {
      const gym = await seedGym("race");
      const paymentId = await pay(gym, "6000");
      const attempt = () =>
        reversePayment(gym.owner.id, paymentId, {
          amount: "4000",
          reason: "OTHER",
          explanation: "",
        });
      const results = await Promise.allSettled([attempt(), attempt()]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(
        (rejected[0] as PromiseRejectedResult).reason,
      ).toBeInstanceOf(PaymentReversalExceedsError);
      const total = await db.paymentReversal.aggregate({
        where: { organizationId: gym.org.id, paymentId },
        _sum: { amount: true },
      });
      expect(total._sum.amount?.toString()).toBe("4000");
      expect(
        await auditCount(gym.org.id, AUDIT_EVENT_PAYMENT_REVERSED, paymentId),
      ).toBe(1);
    });

    it("same-token sequential and concurrent retries resolve to one reversal and one audit event", async () => {
      const gym = await seedGym("idem");
      const paymentId = await pay(gym, "6000");
      const input = { amount: "2000", reason: "OTHER", explanation: "" };
      const token = `tok-rev-seq-${suffix}`;

      const first = await reversePayment(gym.owner.id, paymentId, input, {
        idempotencyKey: token,
      });
      expect(first.deduplicated).toBeUndefined();
      const retry = await reversePayment(gym.owner.id, paymentId, input, {
        idempotencyKey: token,
      });
      expect(retry).toEqual({ reversalId: first.reversalId, deduplicated: true });

      const payment2 = await pay(gym, "3000");
      const token2 = `tok-rev-conc-${suffix}`;
      const results = await Promise.allSettled([
        reversePayment(gym.owner.id, payment2, input, {
          idempotencyKey: token2,
        }),
        reversePayment(gym.owner.id, payment2, input, {
          idempotencyKey: token2,
        }),
        reversePayment(gym.owner.id, payment2, input, {
          idempotencyKey: token2,
        }),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      expect(fulfilled).toHaveLength(3);
      const ids = new Set(
        fulfilled.map(
          (r) =>
            (r as PromiseFulfilledResult<{ reversalId: string }>).value
              .reversalId,
        ),
      );
      expect(ids.size).toBe(1);
      expect(await reversalCount(gym.org.id)).toBe(2);
      expect(
        await auditCount(gym.org.id, AUDIT_EVENT_PAYMENT_REVERSED, paymentId),
      ).toBe(1);
      expect(
        await auditCount(gym.org.id, AUDIT_EVENT_PAYMENT_REVERSED, payment2),
      ).toBe(1);
    });

    it("same token with a different payload conflicts; the token is organization-scoped", async () => {
      const gymA = await seedGym("tok-a");
      const gymB = await seedGym("tok-b");
      const token = `tok-rev-shared-${suffix}`;
      const paymentA = await pay(gymA, "6000");
      await reversePayment(gymA.owner.id, paymentA, {
        amount: "1000",
        reason: "OTHER",
        explanation: "",
      }, { idempotencyKey: token });

      await expect(
        reversePayment(gymA.owner.id, paymentA, {
          amount: "2000",
          reason: "OTHER",
          explanation: "",
        }, { idempotencyKey: token }),
      ).rejects.toBeInstanceOf(PaymentIdempotencyConflictError);
      expect(await reversalCount(gymA.org.id)).toBe(1);

      // The same token in another organization is an independent operation.
      const paymentB = await pay(gymB, "6000");
      const resultB = await reversePayment(gymB.owner.id, paymentB, {
        amount: "2000",
        reason: "OTHER",
        explanation: "",
      }, { idempotencyKey: token });
      expect(resultB.deduplicated).toBeUndefined();
      expect(await reversalCount(gymB.org.id)).toBe(1);
    });

    it("cross-tenant reversal is an indistinguishable not-found and writes nothing", async () => {
      const gymA = await seedGym("xtenant-a");
      const gymB = await seedGym("xtenant-b");
      const paymentA = await pay(gymA, "6000");

      await expect(
        reversePayment(gymB.owner.id, paymentA, FULL),
      ).rejects.toBeInstanceOf(PaymentNotFoundError);
      await expect(
        reversePayment(gymB.owner.id, paymentA, FULL),
      ).rejects.toEqual(new PaymentNotFoundError("Payment not found."));
      expect(await reversalCount(gymA.org.id)).toBe(0);
      expect(await reversalCount(gymB.org.id)).toBe(0);
      expect(await netPaid(gymA)).toBe(600_000);
    });

    it("keyless double submission records two reversals (documented), still bounded by the invariant", async () => {
      const gym = await seedGym("keyless");
      const paymentId = await pay(gym, "6000");
      const input = { amount: "3000", reason: "OTHER", explanation: "" };
      await reversePayment(gym.owner.id, paymentId, input);
      await reversePayment(gym.owner.id, paymentId, input);
      expect(await reversalCount(gym.org.id)).toBe(2);
      expect(await netPaid(gym)).toBe(0);
    });

    it("reversing a claim-confirmed payment nets the balance and leaves the claim CONFIRMED", async () => {
      const gym = await seedGym("claim");
      const claim = await db.paymentClaim.create({
        data: {
          organizationId: gym.org.id,
          memberId: gym.member.id,
          membershipId: gym.membership.id,
          claimedAmount: new Prisma.Decimal("6000"),
          paymentMethod: "UPI",
          reference: null,
          status: "PENDING",
        },
        select: { id: true },
      });
      const { paymentId } = await confirmPaymentClaim(gym.owner.id, claim.id);
      expect(paymentId).toBeTruthy();
      expect(await netPaid(gym)).toBe(600_000);

      await reversePayment(gym.owner.id, paymentId, {
        amount: "6000",
        reason: "PAYMENT_FAILED",
        explanation: "",
      });
      expect(await netPaid(gym)).toBe(0);

      const claimAfter = await db.paymentClaim.findUniqueOrThrow({
        where: { id: claim.id },
      });
      expect(claimAfter.status).toBe("CONFIRMED");
      const audit = await db.auditLog.findFirstOrThrow({
        where: {
          organizationId: gym.org.id,
          event: AUDIT_EVENT_PAYMENT_REVERSED,
          targetId: paymentId,
        },
      });
      expect(audit.metadata).toMatchObject({ paymentClaimId: claim.id });
      expect(
        await auditCount(gym.org.id, AUDIT_EVENT_PAYMENT_CONFIRMED, paymentId),
      ).toBe(1);
    });

    it("an audit-write failure rolls back the reversal; a reversal-write failure writes no audit", async () => {
      const gym = await seedGym("rollback");
      const paymentId = await pay(gym, "6000");

      await db.$executeRawUnsafe(
        `CREATE OR REPLACE FUNCTION rev_test_fail_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'forced audit failure (test)'; END; $$ LANGUAGE plpgsql`,
      );
      await db.$executeRawUnsafe(
        `CREATE TRIGGER rev_test_fail_audit_trg BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION rev_test_fail_audit()`,
      );
      try {
        await expect(
          reversePayment(gym.owner.id, paymentId, {
            amount: "1000",
            reason: "OTHER",
            explanation: "",
          }),
        ).rejects.toThrow();
      } finally {
        await db.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS rev_test_fail_audit_trg ON audit_logs`,
        );
        await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS rev_test_fail_audit()`);
      }
      expect(await reversalCount(gym.org.id)).toBe(0);

      await db.$executeRawUnsafe(
        `CREATE OR REPLACE FUNCTION rev_test_fail_reversal() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'forced reversal failure (test)'; END; $$ LANGUAGE plpgsql`,
      );
      await db.$executeRawUnsafe(
        `CREATE TRIGGER rev_test_fail_reversal_trg BEFORE INSERT ON payment_reversals FOR EACH ROW EXECUTE FUNCTION rev_test_fail_reversal()`,
      );
      try {
        await expect(
          reversePayment(gym.owner.id, paymentId, {
            amount: "1000",
            reason: "OTHER",
            explanation: "",
          }),
        ).rejects.toThrow();
      } finally {
        await db.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS rev_test_fail_reversal_trg ON payment_reversals`,
        );
        await db.$executeRawUnsafe(
          `DROP FUNCTION IF EXISTS rev_test_fail_reversal()`,
        );
      }
      expect(
        await auditCount(gym.org.id, AUDIT_EVENT_PAYMENT_REVERSED, paymentId),
      ).toBe(0);
      expect(await netPaid(gym)).toBe(600_000);
    });

    it("a payment with reversals cannot be deleted out from under them (Restrict)", async () => {
      const gym = await seedGym("restrict");
      const paymentId = await pay(gym, "6000");
      const { reversalId } = await reversePayment(gym.owner.id, paymentId, {
        amount: "1000",
        reason: "OTHER",
        explanation: "",
      });
      await expect(
        db.payment.delete({ where: { id: paymentId } }),
      ).rejects.toThrow();
      await db.paymentReversal.delete({ where: { id: reversalId } });
      await expect(
        db.payment.delete({ where: { id: paymentId } }),
      ).resolves.toMatchObject({ id: paymentId });
    });

    it("history DTOs expose gross receipts, reversal totals, remaining amounts, and separate reversal entries", async () => {
      const gym = await seedGym("history");
      const paymentId = await pay(gym, "6000");
      await reversePayment(gym.owner.id, paymentId, {
        amount: "2000",
        reason: "WRONG_AMOUNT",
        explanation: "Desk typo",
      });

      const { items: receipts, truncated: receiptsTruncated } =
        await listPaymentsForMembership(gym.org.id, gym.membership.id);
      expect(receiptsTruncated).toBe(false);
      expect(receipts).toHaveLength(1);
      expect(receipts[0]).toMatchObject({
        id: paymentId,
        amountPaise: 600_000,
        reversedPaise: 200_000,
        remainingReversiblePaise: 400_000,
      });

      await reversePayment(gym.owner.id, paymentId, {
        amount: "4000",
        reason: "OTHER",
        explanation: "",
      });
      const { items: receiptsAfter } = await listPaymentsForMembership(
        gym.org.id,
        gym.membership.id,
      );
      expect(receiptsAfter[0]?.remainingReversiblePaise).toBe(0);

      const { items: reversals, truncated: reversalsTruncated } =
        await listReversalsForMembership(gym.org.id, gym.membership.id);
      expect(reversalsTruncated).toBe(false);
      expect(reversals).toHaveLength(2);
      // Newest first.
      expect(reversals[0]).toMatchObject({
        paymentId,
        amountPaise: 400_000,
        reason: "OTHER",
        reversedByRole: "OWNER",
      });
      expect(reversals[1]).toMatchObject({
        paymentId,
        amountPaise: 200_000,
        reason: "WRONG_AMOUNT",
        explanation: "Desk typo",
      });
    });

    it("overpayment stays exact through a reversal (OVERPAID → PARTIALLY_PAID)", async () => {
      const gym = await seedGym("overpaid");
      const paymentId = await pay(gym, "7000");
      let detail = await getMemberDetail(gym.owner.id, gym.member.id);
      expect(detail?.membership).toMatchObject({
        paidPaise: 700_000,
        outstandingPaise: 0,
        paymentStatus: "OVERPAID",
      });
      await reversePayment(gym.owner.id, paymentId, {
        amount: "2000",
        reason: "WRONG_AMOUNT",
        explanation: "",
      });
      detail = await getMemberDetail(gym.owner.id, gym.member.id);
      expect(detail?.membership).toMatchObject({
        paidPaise: 500_000,
        outstandingPaise: 100_000,
        paymentStatus: "PARTIALLY_PAID",
      });
    });

    it("member-facing reads are net and expose no staff identity or staff notes", async () => {
      const gym = await seedGym("memberview");
      const paymentId = await pay(gym, "6000");
      await reversePayment(gym.owner.id, paymentId, {
        amount: "2500",
        reason: "REFUNDED_TO_MEMBER",
        explanation: "Internal desk note",
      });
      const scope: MemberClaimScope = {
        userId: gym.owner.id,
        organizationId: gym.org.id,
        memberId: gym.member.id,
      };
      const summary = await getOwnMembershipSummary(scope);
      expect(summary).toMatchObject({
        paidPaise: 350_000,
        outstandingPaise: 250_000,
        paymentStatus: "PARTIALLY_PAID",
      });
      const own = await listOwnPaymentReversals(scope);
      expect(own).toHaveLength(1);
      expect(own[0]).toMatchObject({
        paymentId,
        amountPaise: 250_000,
        reason: "REFUNDED_TO_MEMBER",
      });
      expect(Object.keys(own[0] ?? {}).sort()).toEqual([
        "amountPaise",
        "id",
        "paymentId",
        "reason",
        "reversedAt",
      ]);
    });
  },
);
