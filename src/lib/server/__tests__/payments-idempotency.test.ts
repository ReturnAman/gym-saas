import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

import { db } from "@/lib/server/db";
import {
  AUDIT_EVENT_PAYMENT_CLAIM_CONFIRMED,
  AUDIT_EVENT_PAYMENT_CONFIRMED,
} from "@/lib/server/audit";
import {
  PaymentIdempotencyConflictError,
  recordPayment,
} from "@/lib/server/payments";
import {
  PaymentClaimConflictError,
  PaymentClaimIdempotencyConflictError,
  confirmPaymentClaim,
} from "@/lib/server/payment-claims";
import { PaymentValidationError } from "@/lib/members";

/**
 * Payment idempotency (H4) against a real PostgreSQL database.
 *
 * One intentional operation — identified by a client-generated token
 * stored on the Payment under a unique (organization_id,
 * idempotency_key) index — may create at most one payment, however it
 * is retried: double-click, concurrent duplicates, or a retry after a
 * lost response. A token reused with a different payload is rejected;
 * a new token is always a new payment.
 */

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const MIGRATION_SQL_PATH = path.join(
  repoRoot,
  "prisma/migrations/20261014120000_add_payment_idempotency_key/migration.sql",
);
const SCHEMA_PATH = path.join(repoRoot, "prisma/schema.prisma");

describe("payment idempotency — schema coherence", () => {
  const migrationSql = readFileSync(MIGRATION_SQL_PATH, "utf8");
  const schema = readFileSync(SCHEMA_PATH, "utf8");

  it("adds a nullable idempotency_key column and a composite unique index", () => {
    expect(migrationSql).toMatch(
      /ALTER TABLE "payments" ADD COLUMN "idempotency_key" TEXT;/,
    );
    expect(migrationSql).toMatch(
      /CREATE UNIQUE INDEX "payments_organization_id_idempotency_key_key" ON "payments"\("organization_id", "idempotency_key"\)/,
    );
    expect(schema).toMatch(/@@unique\(\[organizationId, idempotencyKey\]\)/);
  });
});

describe.skipIf(process.env.RUN_DB_TESTS !== "true")(
  "payment idempotency — database enforcement",
  () => {
    const suffix = crypto.randomUUID();
    const createdOrgIds: string[] = [];
    const createdUserIds: string[] = [];

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
        await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
      }
      await db.$disconnect();
    });

    async function seedGym(tag: string) {
      const org = await db.organization.create({
        data: { name: `Idem Gym ${tag} ${suffix}` },
        select: { id: true },
      });
      createdOrgIds.push(org.id);
      const owner = await db.user.create({
        data: { clerkUserId: `idem-owner-${tag}-${suffix}` },
        select: { id: true },
      });
      createdUserIds.push(owner.id);
      await db.organizationMembership.create({
        data: { userId: owner.id, organizationId: org.id, role: "OWNER" },
      });
      const member = await db.member.create({
        data: {
          organizationId: org.id,
          name: "Idem Member",
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
          expiryDate: new Date(Date.UTC(2026, 1, 1)),
          fee: new Prisma.Decimal("6000"),
        },
        select: { id: true },
      });
      return { org, owner, member, membership };
    }

    async function seedClaim(
      gym: Awaited<ReturnType<typeof seedGym>>,
      amount = "6000",
    ) {
      return db.paymentClaim.create({
        data: {
          organizationId: gym.org.id,
          memberId: gym.member.id,
          membershipId: gym.membership.id,
          claimedAmount: new Prisma.Decimal(amount),
          paymentMethod: "UPI",
          reference: null,
          status: "PENDING",
        },
        select: { id: true },
      });
    }

    const token = (tag: string) => `tok-${tag}-${suffix}`;

    async function paymentCount(orgId: string) {
      return db.payment.count({ where: { organizationId: orgId } });
    }

    async function auditCount(orgId: string, event: string, targetId: string) {
      return db.auditLog.count({
        where: { organizationId: orgId, event, targetId },
      });
    }

    it("sequential retry with the same token resolves to the original payment", async () => {
      const gym = await seedGym("seq");
      const input = { amount: "500", paymentMethod: "UPI", reference: "" };
      const first = await recordPayment(gym.owner.id, gym.member.id, input, {
        idempotencyKey: token("seq"),
      });
      expect(first.deduplicated).toBeUndefined();
      const retry = await recordPayment(gym.owner.id, gym.member.id, input, {
        idempotencyKey: token("seq"),
      });
      expect(retry.paymentId).toBe(first.paymentId);
      expect(retry.deduplicated).toBe(true);
      expect(await paymentCount(gym.org.id)).toBe(1);
      expect(
        await auditCount(gym.org.id, AUDIT_EVENT_PAYMENT_CONFIRMED, first.paymentId),
      ).toBe(1);
    });

    it("concurrent submissions with the same token create exactly one payment", async () => {
      const gym = await seedGym("conc");
      const input = { amount: "750", paymentMethod: "CASH", reference: "" };
      const results = await Promise.allSettled([
        recordPayment(gym.owner.id, gym.member.id, input, {
          idempotencyKey: token("conc"),
        }),
        recordPayment(gym.owner.id, gym.member.id, input, {
          idempotencyKey: token("conc"),
        }),
        recordPayment(gym.owner.id, gym.member.id, input, {
          idempotencyKey: token("conc"),
        }),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      expect(fulfilled).toHaveLength(3);
      const ids = new Set(
        fulfilled.map(
          (r) => (r as PromiseFulfilledResult<{ paymentId: string }>).value.paymentId,
        ),
      );
      expect(ids.size).toBe(1);
      expect(await paymentCount(gym.org.id)).toBe(1);
      const paymentId = [...ids][0] as string;
      expect(
        await auditCount(gym.org.id, AUDIT_EVENT_PAYMENT_CONFIRMED, paymentId),
      ).toBe(1);
    });

    it("reusing a token with a different payload is rejected and creates nothing", async () => {
      const gym = await seedGym("conflict");
      await recordPayment(
        gym.owner.id,
        gym.member.id,
        { amount: "500", paymentMethod: "UPI", reference: "" },
        { idempotencyKey: token("conflict") },
      );
      await expect(
        recordPayment(
          gym.owner.id,
          gym.member.id,
          { amount: "501", paymentMethod: "UPI", reference: "" },
          { idempotencyKey: token("conflict") },
        ),
      ).rejects.toBeInstanceOf(PaymentIdempotencyConflictError);
      await expect(
        recordPayment(
          gym.owner.id,
          gym.member.id,
          { amount: "500", paymentMethod: "CASH", reference: "" },
          { idempotencyKey: token("conflict") },
        ),
      ).rejects.toBeInstanceOf(PaymentIdempotencyConflictError);
      expect(await paymentCount(gym.org.id)).toBe(1);
    });

    it("different tokens allow two identical payments for the same member", async () => {
      const gym = await seedGym("two");
      const input = { amount: "500", paymentMethod: "UPI", reference: "" };
      const a = await recordPayment(gym.owner.id, gym.member.id, input, {
        idempotencyKey: token("two-a"),
      });
      const b = await recordPayment(gym.owner.id, gym.member.id, input, {
        idempotencyKey: token("two-b"),
      });
      expect(b.paymentId).not.toBe(a.paymentId);
      expect(await paymentCount(gym.org.id)).toBe(2);
    });

    it("the same token in another organization is an independent payment", async () => {
      const gymA = await seedGym("tenant-a");
      const gymB = await seedGym("tenant-b");
      const input = { amount: "500", paymentMethod: "UPI", reference: "" };
      const a = await recordPayment(gymA.owner.id, gymA.member.id, input, {
        idempotencyKey: token("shared"),
      });
      const b = await recordPayment(gymB.owner.id, gymB.member.id, input, {
        idempotencyKey: token("shared"),
      });
      expect(b.paymentId).not.toBe(a.paymentId);
      expect(await paymentCount(gymA.org.id)).toBe(1);
      expect(await paymentCount(gymB.org.id)).toBe(1);
    });

    it("without a token, behaviour is unchanged (no deduplication)", async () => {
      const gym = await seedGym("notoken");
      const input = { amount: "500", paymentMethod: "UPI", reference: "" };
      await recordPayment(gym.owner.id, gym.member.id, input);
      await recordPayment(gym.owner.id, gym.member.id, input);
      expect(await paymentCount(gym.org.id)).toBe(2);
    });

    it("a malformed token is a validation error and creates nothing", async () => {
      const gym = await seedGym("badtoken");
      await expect(
        recordPayment(
          gym.owner.id,
          gym.member.id,
          { amount: "500", paymentMethod: "UPI", reference: "" },
          { idempotencyKey: "short" },
        ),
      ).rejects.toBeInstanceOf(PaymentValidationError);
      expect(await paymentCount(gym.org.id)).toBe(0);
    });

    it("claim confirmation: sequential retry with the same token resolves to the original", async () => {
      const gym = await seedGym("claim-seq");
      const claim = await seedClaim(gym);
      const first = await confirmPaymentClaim(gym.owner.id, claim.id, {
        idempotencyKey: token("claim-seq"),
      });
      expect(first.deduplicated).toBeUndefined();
      const retry = await confirmPaymentClaim(gym.owner.id, claim.id, {
        idempotencyKey: token("claim-seq"),
      });
      expect(retry.paymentId).toBe(first.paymentId);
      expect(retry.deduplicated).toBe(true);
      expect(await paymentCount(gym.org.id)).toBe(1);
      expect(
        await auditCount(gym.org.id, AUDIT_EVENT_PAYMENT_CLAIM_CONFIRMED, claim.id),
      ).toBe(1);
      expect(
        await auditCount(gym.org.id, AUDIT_EVENT_PAYMENT_CONFIRMED, first.paymentId),
      ).toBe(1);
      const stored = await db.paymentClaim.findUnique({
        where: { id: claim.id },
        select: { status: true },
      });
      expect(stored?.status).toBe("CONFIRMED");
    });

    it("claim confirmation: concurrent attempts with the same token create one payment", async () => {
      const gym = await seedGym("claim-conc");
      const claim = await seedClaim(gym);
      const results = await Promise.allSettled([
        confirmPaymentClaim(gym.owner.id, claim.id, {
          idempotencyKey: token("claim-conc"),
        }),
        confirmPaymentClaim(gym.owner.id, claim.id, {
          idempotencyKey: token("claim-conc"),
        }),
      ]);
      // Exactly one payment may exist, and any rejection must be the
      // typed already-decided conflict (never a raw database error):
      // the loser either resolves to the winner or conflicts cleanly,
      // and a later retry with the same token must resolve.
      expect(await paymentCount(gym.org.id)).toBe(1);
      for (const r of results) {
        if (r.status === "rejected") {
          expect(r.reason).toBeInstanceOf(PaymentClaimConflictError);
        }
      }
      const payment = await db.payment.findFirst({
        where: { organizationId: gym.org.id },
        select: { id: true },
      });
      const retry = await confirmPaymentClaim(gym.owner.id, claim.id, {
        idempotencyKey: token("claim-conc"),
      });
      expect(retry.paymentId).toBe(payment?.id);
      expect(retry.deduplicated).toBe(true);
      expect(
        await auditCount(gym.org.id, AUDIT_EVENT_PAYMENT_CLAIM_CONFIRMED, claim.id),
      ).toBe(1);
      expect(
        await auditCount(
          gym.org.id,
          AUDIT_EVENT_PAYMENT_CONFIRMED,
          payment?.id ?? "",
        ),
      ).toBe(1);
    });

    it("claim confirmation: the same token with a different amount is rejected", async () => {
      const gym = await seedGym("claim-conflict");
      const claim = await seedClaim(gym);
      await confirmPaymentClaim(gym.owner.id, claim.id, {
        idempotencyKey: token("claim-conflict"),
      });
      await expect(
        confirmPaymentClaim(gym.owner.id, claim.id, {
          amount: "4500",
          idempotencyKey: token("claim-conflict"),
        }),
      ).rejects.toBeInstanceOf(PaymentClaimIdempotencyConflictError);
      expect(await paymentCount(gym.org.id)).toBe(1);
    });

    it("claim confirmation without a token keeps the already-decided conflict", async () => {
      const gym = await seedGym("claim-plain");
      const claim = await seedClaim(gym);
      await confirmPaymentClaim(gym.owner.id, claim.id);
      await expect(
        confirmPaymentClaim(gym.owner.id, claim.id),
      ).rejects.toBeInstanceOf(PaymentClaimConflictError);
      expect(await paymentCount(gym.org.id)).toBe(1);
    });

    it("a claim-confirmation token cannot be replayed as a direct payment", async () => {
      const gym = await seedGym("cross-op");
      const claim = await seedClaim(gym);
      await confirmPaymentClaim(gym.owner.id, claim.id, {
        idempotencyKey: token("cross-op"),
      });
      // Same member, same amount/method/reference — only the operation
      // differs (the stored payment belongs to the claim), so the
      // direct recording must be rejected, not resolved.
      await expect(
        recordPayment(
          gym.owner.id,
          gym.member.id,
          { amount: "6000", paymentMethod: "UPI", reference: "" },
          { idempotencyKey: token("cross-op") },
        ),
      ).rejects.toBeInstanceOf(PaymentIdempotencyConflictError);
      expect(await paymentCount(gym.org.id)).toBe(1);
    });

    it("a direct-payment token cannot be replayed as a claim confirmation", async () => {
      const gym = await seedGym("cross-op-rev");
      const claim = await seedClaim(gym);
      // A direct recording first: same member, same amount, method and
      // reference as the pending claim — only the operation differs.
      const direct = await recordPayment(
        gym.owner.id,
        gym.member.id,
        { amount: "6000", paymentMethod: "UPI", reference: "" },
        { idempotencyKey: token("cross-op-rev") },
      );
      await expect(
        confirmPaymentClaim(gym.owner.id, claim.id, {
          idempotencyKey: token("cross-op-rev"),
        }),
      ).rejects.toBeInstanceOf(PaymentClaimIdempotencyConflictError);
      // Nothing new was persisted: still exactly the direct payment and
      // its single audit, no claim audit, and the claim is undecided.
      expect(await paymentCount(gym.org.id)).toBe(1);
      expect(
        await auditCount(gym.org.id, AUDIT_EVENT_PAYMENT_CONFIRMED, direct.paymentId),
      ).toBe(1);
      expect(
        await auditCount(gym.org.id, AUDIT_EVENT_PAYMENT_CLAIM_CONFIRMED, claim.id),
      ).toBe(0);
      const stored = await db.paymentClaim.findUnique({
        where: { id: claim.id },
        select: { status: true },
      });
      expect(stored?.status).toBe("PENDING");
      // An ordinary confirmation with a fresh token still succeeds.
      const confirmed = await confirmPaymentClaim(gym.owner.id, claim.id, {
        idempotencyKey: token("cross-op-rev-fresh"),
      });
      expect(confirmed.deduplicated).toBeUndefined();
      expect(confirmed.paymentId).not.toBe(direct.paymentId);
      expect(await paymentCount(gym.org.id)).toBe(2);
      expect(
        await auditCount(gym.org.id, AUDIT_EVENT_PAYMENT_CLAIM_CONFIRMED, claim.id),
      ).toBe(1);
    });
  },
);
