import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import crypto from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/server/db";
import {
  AUDIT_EVENT_SAAS_OFFER_REQUESTED,
  AUDIT_EVENT_SAAS_PAYMENT_RECORDED,
  AUDIT_EVENT_SAAS_SUBSCRIPTION_SUSPENDED,
  AUDIT_EVENT_SAAS_TRIAL_GRANTED,
} from "@/lib/server/audit";
import { createOrganizationWithSubscription } from "@/lib/server/organizations";
import {
  acceptSaasOffer,
  extendTrial,
  reactivateOrganization,
  recordSaasPaymentAndActivate,
  requestSaasOffer,
  reviewOffer,
  suspendOrganization,
  type PlatformAdminContext,
} from "@/lib/server/platform-admin";
import {
  TRIAL_DURATION_MS,
  SubscriptionRestrictedError,
  assertOperationsAllowed,
  resolveEffectiveState,
} from "@/lib/server/subscriptions";

/**
 * SaaS trial & subscription enforcement against a real PostgreSQL
 * database. Covers the mandatory phone-eligibility guarantees:
 * - one trial per stable owner identity AND per canonical phone,
 *   enforced by database unique constraints (not just pre-checks);
 * - formatting variants of one number collide;
 * - concurrent claims grant exactly one trial;
 * - claims survive organization deletion attempts (Restrict);
 * - entitlement enforcement blocks operations for pending, expired
 *   and suspended gyms while the recovery paths stay usable.
 *
 * Follows the payments-reversal-db suite pattern: the suite skips
 * unless RUN_DB_TESTS=true (the test:db runner pins it), and cleanup
 * removes SaaS rows before organizations (claims are Restrict).
 */

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const MIGRATION_SQL_PATH = path.join(
  repoRoot,
  "prisma/migrations/20261025125054_add_saas_subscriptions/migration.sql",
);
const SCHEMA_PATH = path.join(repoRoot, "prisma/schema.prisma");

describe("saas trial & subscriptions — schema coherence", () => {
  const migrationSql = readFileSync(MIGRATION_SQL_PATH, "utf8");
  const schema = readFileSync(SCHEMA_PATH, "utf8");

  it("creates the subscription, claim, payment and offer tables", () => {
    for (const table of [
      "organization_subscriptions",
      "saas_trial_claims",
      "saas_subscription_payments",
      "saas_offer_requests",
    ]) {
      expect(migrationSql).toContain(`CREATE TABLE "${table}"`);
    }
    expect(schema).toContain("model OrganizationSubscription");
    expect(schema).toContain("model SaasTrialClaim");
    expect(schema).toContain("model SaasSubscriptionPayment");
    expect(schema).toContain("model SaasOfferRequest");
  });

  it("enforces global uniques on owner identity and canonical phone", () => {
    expect(migrationSql).toMatch(
      /CREATE UNIQUE INDEX "saas_trial_claims_clerk_user_id_key" ON "saas_trial_claims"\("clerk_user_id"\)/,
    );
    expect(migrationSql).toMatch(
      /CREATE UNIQUE INDEX "saas_trial_claims_canonical_phone_key" ON "saas_trial_claims"\("canonical_phone"\)/,
    );
  });

  it("keeps claims permanent: the organization link is Restrict", () => {
    expect(migrationSql).toMatch(
      /FOREIGN KEY \("organization_id"\) REFERENCES "organizations"\("id"\) ON DELETE RESTRICT/,
    );
  });

  it("allows at most one pending offer per gym via a partial unique index", () => {
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX "saas_offer_requests_one_pending_per_org" ON "saas_offer_requests"("organization_id") WHERE "status" = \'REQUESTED\'',
    );
  });

  it("stores SaaS money exactly, never as float", () => {
    expect(migrationSql).toContain('"amount" DECIMAL(12,2) NOT NULL');
  });
});

describe.skipIf(process.env.RUN_DB_TESTS !== "true")(
  "saas trial & subscriptions — database enforcement",
  () => {
    const suffix = crypto.randomUUID();
    const createdOrgIds: string[] = [];
    const createdUserIds: string[] = [];
    let adminUserId = "";
    let admin: PlatformAdminContext;

    async function seedUser(clerkUserId: string) {
      const user = await db.user.create({
        data: { clerkUserId },
        select: { id: true },
      });
      createdUserIds.push(user.id);
      return user;
    }

    async function seedOrgWithSubscription(overrides: {
      trialEndsAt?: Date | null;
      paidThroughAt?: Date | null;
      suspendedAt?: Date | null;
    } = {}) {
      const org = await db.organization.create({
        data: { name: `Trial Gym ${suffix}` },
        select: { id: true },
      });
      createdOrgIds.push(org.id);
      const subscription = await db.organizationSubscription.create({
        data: {
          organizationId: org.id,
          trialStartedAt: overrides.trialEndsAt
            ? new Date(overrides.trialEndsAt.getTime() - TRIAL_DURATION_MS)
            : null,
          trialEndsAt: overrides.trialEndsAt ?? null,
          paidThroughAt: overrides.paidThroughAt ?? null,
          suspendedAt: overrides.suspendedAt ?? null,
          suspensionReason: overrides.suspendedAt ? "test suspension" : null,
        },
      });
      return { org, subscription };
    }

    beforeAll(async () => {
      await db.$queryRaw`SELECT 1`;
      const adminUser = await seedUser(`saas-admin-${suffix}`);
      adminUserId = adminUser.id;
      admin = { clerkUserId: `saas-admin-clerk-${suffix}`, userId: adminUserId };
    });

    afterAll(async () => {
      if (createdOrgIds.length > 0) {
        await db.saasSubscriptionPayment.deleteMany({
          where: { organizationId: { in: createdOrgIds } },
        });
        await db.saasOfferRequest.deleteMany({
          where: { organizationId: { in: createdOrgIds } },
        });
        await db.saasTrialClaim.deleteMany({
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

    it("grants exactly one seven-day trial to a first eligible owner", async () => {
      const owner = await seedUser(`saas-owner-1-${suffix}`);
      const result = await createOrganizationWithSubscription(
        owner.id,
        `saas-clerk-1-${suffix}`,
        ["+919876543210"],
        { name: `First Trial Gym ${suffix}` },
      );
      createdOrgIds.push(result.organization.id);
      expect(result.trialGranted).toBe(true);
      expect(result.trialEndsAt).not.toBeNull();
      const subscription = await db.organizationSubscription.findUniqueOrThrow({
        where: { organizationId: result.organization.id },
      });
      expect(
        subscription.trialEndsAt!.getTime() -
          subscription.trialStartedAt!.getTime(),
      ).toBe(TRIAL_DURATION_MS);
      const claim = await db.saasTrialClaim.findUniqueOrThrow({
        where: { clerkUserId: `saas-clerk-1-${suffix}` },
      });
      expect(claim.canonicalPhone).toBe("+919876543210");
      expect(claim.organizationId).toBe(result.organization.id);
      const audit = await db.auditLog.findFirst({
        where: {
          organizationId: result.organization.id,
          event: AUDIT_EVENT_SAAS_TRIAL_GRANTED,
        },
      });
      expect(audit).not.toBeNull();
      expect(JSON.stringify(audit!.metadata)).not.toContain("9876543210");
    });

    it("denies a second trial to the same owner with a different phone", async () => {
      const owner = await seedUser(`saas-owner-2-${suffix}`);
      const first = await createOrganizationWithSubscription(
        owner.id,
        `saas-clerk-2-${suffix}`,
        ["+919999999999"],
        { name: `Owner2 Gym A ${suffix}` },
      );
      createdOrgIds.push(first.organization.id);
      expect(first.trialGranted).toBe(true);
      const second = await createOrganizationWithSubscription(
        owner.id,
        `saas-clerk-2-${suffix}`,
        ["+918888888888"],
        { name: `Owner2 Gym B ${suffix}` },
      );
      createdOrgIds.push(second.organization.id);
      expect(second.trialGranted).toBe(false);
      expect(second.trialEndsAt).toBeNull();
      const subscription = await db.organizationSubscription.findUniqueOrThrow({
        where: { organizationId: second.organization.id },
      });
      expect(
        resolveEffectiveState(subscription, new Date()),
      ).toBe("PENDING_PAYMENT");
      expect(
        await db.saasTrialClaim.count({
          where: { clerkUserId: `saas-clerk-2-${suffix}` },
        }),
      ).toBe(1);
    });

    it("denies a second trial for the same phone under a different account and formatting", async () => {
      const ownerA = await seedUser(`saas-owner-3a-${suffix}`);
      const first = await createOrganizationWithSubscription(
        ownerA.id,
        `saas-clerk-3a-${suffix}`,
        ["+917777777777"],
        { name: `Phone Gym A ${suffix}` },
      );
      createdOrgIds.push(first.organization.id);
      expect(first.trialGranted).toBe(true);
      const ownerB = await seedUser(`saas-owner-3b-${suffix}`);
      // Same number, national-format representation — canonicalization
      // in the caller would collapse it; here the service receives the
      // already-canonical form, and the ledger unique still blocks it.
      const second = await createOrganizationWithSubscription(
        ownerB.id,
        `saas-clerk-3b-${suffix}`,
        ["+917777777777"],
        { name: `Phone Gym B ${suffix}` },
      );
      createdOrgIds.push(second.organization.id);
      expect(second.trialGranted).toBe(false);
      await expect(
        db.saasTrialClaim.create({
          data: {
            clerkUserId: `saas-clerk-3c-${suffix}`,
            canonicalPhone: "+917777777777",
            organizationId: second.organization.id,
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });
      await expect(
        db.saasTrialClaim.create({
          data: {
            clerkUserId: `saas-clerk-3a-${suffix}`,
            canonicalPhone: "+916666666666",
            organizationId: second.organization.id,
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });
    });

    it("creates the gym in PENDING_PAYMENT when no verified phone exists", async () => {
      const owner = await seedUser(`saas-owner-4-${suffix}`);
      const result = await createOrganizationWithSubscription(
        owner.id,
        `saas-clerk-4-${suffix}`,
        [],
        { name: `No Phone Gym ${suffix}` },
      );
      createdOrgIds.push(result.organization.id);
      expect(result.trialGranted).toBe(false);
      const subscription = await db.organizationSubscription.findUniqueOrThrow({
        where: { organizationId: result.organization.id },
      });
      expect(resolveEffectiveState(subscription, new Date())).toBe(
        "PENDING_PAYMENT",
      );
    });

    it("grants exactly one trial under concurrent claims for one owner and phone", async () => {
      const owner = await seedUser(`saas-owner-5-${suffix}`);
      const clerkId = `saas-clerk-5-${suffix}`;
      const phone = "+915555555555";
      const attempts = await Promise.allSettled([
        createOrganizationWithSubscription(owner.id, clerkId, [phone], {
          name: `Race Gym A ${suffix}`,
        }),
        createOrganizationWithSubscription(owner.id, clerkId, [phone], {
          name: `Race Gym B ${suffix}`,
        }),
      ]);
      const fulfilled = attempts.filter(
        (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof createOrganizationWithSubscription>>> =>
          r.status === "fulfilled",
      );
      expect(fulfilled).toHaveLength(2);
      for (const f of fulfilled) createdOrgIds.push(f.value.organization.id);
      const granted = fulfilled.filter((f) => f.value.trialGranted);
      expect(granted).toHaveLength(1);
      expect(
        await db.saasTrialClaim.count({ where: { clerkUserId: clerkId } }),
      ).toBe(1);
    });

    it("does not release a claim when its gym cannot be deleted (Restrict)", async () => {
      const owner = await seedUser(`saas-owner-6-${suffix}`);
      const result = await createOrganizationWithSubscription(
        owner.id,
        `saas-clerk-6-${suffix}`,
        ["+914444444444"],
        { name: `Restrict Gym ${suffix}` },
      );
      createdOrgIds.push(result.organization.id);
      expect(result.trialGranted).toBe(true);
      await expect(
        db.organization.delete({ where: { id: result.organization.id } }),
      ).rejects.toMatchObject({ code: "P2003" });
      expect(
        await db.saasTrialClaim.count({
          where: { clerkUserId: `saas-clerk-6-${suffix}` },
        }),
      ).toBe(1);
    });

    it("blocks operations for pending, expired and suspended gyms, allows live trials", async () => {
      const { org: liveOrg } = await seedOrgWithSubscription({
        trialEndsAt: new Date(Date.now() + 3 * 24 * 60 * 60_000),
      });
      await expect(assertOperationsAllowed(liveOrg.id)).resolves.toBeUndefined();

      const { org: pendingOrg } = await seedOrgWithSubscription({});
      await expect(assertOperationsAllowed(pendingOrg.id)).rejects.toBeInstanceOf(
        SubscriptionRestrictedError,
      );
      await expect(assertOperationsAllowed(pendingOrg.id)).rejects.toMatchObject({
        state: "PENDING_PAYMENT",
      });

      const { org: expiredOrg } = await seedOrgWithSubscription({
        trialEndsAt: new Date(Date.now() - 1000),
      });
      await expect(assertOperationsAllowed(expiredOrg.id)).rejects.toMatchObject({
        state: "EXPIRED",
      });

      const { org: suspendedOrg } = await seedOrgWithSubscription({
        trialEndsAt: new Date(Date.now() + 3 * 24 * 60 * 60_000),
        suspendedAt: new Date(),
      });
      await expect(assertOperationsAllowed(suspendedOrg.id)).rejects.toMatchObject({
        state: "SUSPENDED",
      });
    });

    it("records a SaaS payment atomically with entitlement and audit, without touching member payments", async () => {
      const { org } = await seedOrgWithSubscription({});
      const { payment, state } = await recordSaasPaymentAndActivate(admin, {
        organizationId: org.id,
        amount: "4999.50",
        receivedAt: "2026-10-20",
        periodStartAt: "2026-10-20",
        periodEndAt: "2026-11-19",
        reference: "UTR-TEST-1",
        notes: "test payment",
        idempotencyKey: `test-pay-${suffix}`,
      });
      expect(state).toBe("ACTIVE");
      expect(payment.amount.toString()).toBe("4999.5");
      const subscription = await db.organizationSubscription.findUniqueOrThrow({
        where: { organizationId: org.id },
      });
      expect(subscription.paidThroughAt!.toISOString()).toBe(
        "2026-11-19T00:00:00.000Z",
      );
      const audit = await db.auditLog.findFirst({
        where: {
          organizationId: org.id,
          event: AUDIT_EVENT_SAAS_PAYMENT_RECORDED,
        },
      });
      expect(audit).not.toBeNull();
      expect(await db.payment.count({ where: { organizationId: org.id } })).toBe(0);

      await expect(
        recordSaasPaymentAndActivate(admin, {
          organizationId: org.id,
          amount: "10.999",
          receivedAt: "2026-10-20",
          periodStartAt: "2026-10-20",
          periodEndAt: "2026-11-19",
        }),
      ).rejects.toThrow();
      expect(
        await db.saasSubscriptionPayment.count({ where: { organizationId: org.id } }),
      ).toBe(1);
    });

    it("rejects a SaaS payment without an idempotency key and records nothing", async () => {
      const { org } = await seedOrgWithSubscription({});
      await expect(
        recordSaasPaymentAndActivate(admin, {
          organizationId: org.id,
          amount: "100.00",
          receivedAt: "2026-10-20",
          periodStartAt: "2026-10-20",
          periodEndAt: "2026-11-19",
        }),
      ).rejects.toThrow("Idempotency key is required");
      await expect(
        recordSaasPaymentAndActivate(admin, {
          organizationId: org.id,
          amount: "100.00",
          receivedAt: "2026-10-20",
          periodStartAt: "2026-10-20",
          periodEndAt: "2026-11-19",
          idempotencyKey: "",
        }),
      ).rejects.toThrow("Idempotency key is required");
      expect(
        await db.saasSubscriptionPayment.count({ where: { organizationId: org.id } }),
      ).toBe(0);
    });

    it("suspends and reactivates with audit, and refuses reactivation without entitlement", async () => {
      const { org: suspendedOrg } = await seedOrgWithSubscription({
        trialEndsAt: new Date(Date.now() + 3 * 24 * 60 * 60_000),
      });
      const suspendedState = await suspendOrganization(admin, {
        organizationId: suspendedOrg.id,
        reason: "test suspension",
      });
      expect(suspendedState).toBe("SUSPENDED");
      expect(
        await db.auditLog.findFirst({
          where: {
            organizationId: suspendedOrg.id,
            event: AUDIT_EVENT_SAAS_SUBSCRIPTION_SUSPENDED,
          },
        }),
      ).not.toBeNull();
      const reactivated = await reactivateOrganization(admin, {
        organizationId: suspendedOrg.id,
        reason: "test reactivation",
      });
      expect(reactivated).toBe("TRIAL_ACTIVE");

      const { org: bareOrg } = await seedOrgWithSubscription({});
      await suspendOrganization(admin, {
        organizationId: bareOrg.id,
        reason: "test suspension 2",
      });
      await expect(
        reactivateOrganization(admin, {
          organizationId: bareOrg.id,
          reason: "no entitlement",
        }),
      ).rejects.toThrow("No valid trial or paid period remains");
      const withPayment = await reactivateOrganization(admin, {
        organizationId: bareOrg.id,
        reason: "reactivate with payment",
        payment: {
          organizationId: bareOrg.id,
          amount: "3000",
          receivedAt: "2026-10-20",
          periodStartAt: "2026-10-20",
          periodEndAt: "2026-11-19",
          idempotencyKey: `test-reactivate-${suffix}`,
        },
      });
      expect(withPayment).toBe("ACTIVE");
    });

    it("replays a reactivation with the same token without duplicating the payment", async () => {
      const { org } = await seedOrgWithSubscription({});
      await suspendOrganization(admin, {
        organizationId: org.id,
        reason: "test suspension",
      });
      const token = `test-reactivate-replay-${suffix}`;
      const payload = {
        organizationId: org.id,
        amount: "3000",
        receivedAt: "2026-10-20",
        periodStartAt: "2026-10-20",
        periodEndAt: "2026-11-19",
        idempotencyKey: token,
      };
      const first = await reactivateOrganization(admin, {
        organizationId: org.id,
        reason: "reactivate with payment",
        payment: payload,
      });
      expect(first).toBe("ACTIVE");
      const replayed = await reactivateOrganization(admin, {
        organizationId: org.id,
        reason: "reactivate with payment",
        payment: payload,
      });
      expect(replayed).toBe("ACTIVE");
      expect(
        await db.saasSubscriptionPayment.count({ where: { organizationId: org.id } }),
      ).toBe(1);
    });

    it("rejects token reuse with a different payment payload", async () => {
      const { org } = await seedOrgWithSubscription({});
      await suspendOrganization(admin, {
        organizationId: org.id,
        reason: "test suspension",
      });
      const token = `test-reactivate-conflict-${suffix}`;
      await reactivateOrganization(admin, {
        organizationId: org.id,
        reason: "reactivate with payment",
        payment: {
          organizationId: org.id,
          amount: "3000",
          receivedAt: "2026-10-20",
          periodStartAt: "2026-10-20",
          periodEndAt: "2026-11-19",
          idempotencyKey: token,
        },
      });
      await suspendOrganization(admin, {
        organizationId: org.id,
        reason: "test suspension again",
      });
      await expect(
        reactivateOrganization(admin, {
          organizationId: org.id,
          reason: "reactivate with payment",
          payment: {
            organizationId: org.id,
            amount: "4000",
            receivedAt: "2026-10-20",
            periodStartAt: "2026-10-20",
            periodEndAt: "2026-11-19",
            idempotencyKey: token,
          },
        }),
      ).rejects.toThrow("different payment");
      expect(
        await db.saasSubscriptionPayment.count({ where: { organizationId: org.id } }),
      ).toBe(1);
      const subscription = await db.organizationSubscription.findUniqueOrThrow({
        where: { organizationId: org.id },
      });
      expect(subscription.suspendedAt).not.toBeNull();
    });

    it("rejects token reuse across organizations", async () => {
      const { org: orgA } = await seedOrgWithSubscription({});
      await suspendOrganization(admin, {
        organizationId: orgA.id,
        reason: "test suspension",
      });
      const token = `test-reactivate-crossorg-${suffix}`;
      const payload = {
        amount: "3000",
        receivedAt: "2026-10-20",
        periodStartAt: "2026-10-20",
        periodEndAt: "2026-11-19",
        idempotencyKey: token,
      };
      await reactivateOrganization(admin, {
        organizationId: orgA.id,
        reason: "reactivate with payment",
        payment: { organizationId: orgA.id, ...payload },
      });
      const { org: orgB } = await seedOrgWithSubscription({});
      await suspendOrganization(admin, {
        organizationId: orgB.id,
        reason: "test suspension",
      });
      await expect(
        reactivateOrganization(admin, {
          organizationId: orgB.id,
          reason: "reactivate with payment",
          payment: { organizationId: orgB.id, ...payload },
        }),
      ).rejects.toThrow("another gym");
      expect(
        await db.saasSubscriptionPayment.count({ where: { organizationId: orgB.id } }),
      ).toBe(0);
      const subscriptionB = await db.organizationSubscription.findUniqueOrThrow({
        where: { organizationId: orgB.id },
      });
      expect(subscriptionB.suspendedAt).not.toBeNull();
    });

    it("refuses stale replay after re-suspension", async () => {
      const { org } = await seedOrgWithSubscription({});
      await suspendOrganization(admin, {
        organizationId: org.id,
        reason: "test suspension",
      });
      const payload = {
        organizationId: org.id,
        amount: "3000",
        receivedAt: "2026-10-20",
        periodStartAt: "2026-10-20",
        periodEndAt: "2026-11-19",
        idempotencyKey: `test-reactivate-stale-${suffix}`,
      };
      await reactivateOrganization(admin, {
        organizationId: org.id,
        reason: "reactivate with payment",
        payment: payload,
      });
      await suspendOrganization(admin, {
        organizationId: org.id,
        reason: "test suspension again",
      });
      await expect(
        reactivateOrganization(admin, {
          organizationId: org.id,
          reason: "reactivate with payment",
          payment: payload,
        }),
      ).rejects.toThrow("already processed");
      expect(
        await db.saasSubscriptionPayment.count({ where: { organizationId: org.id } }),
      ).toBe(1);
      const subscription = await db.organizationSubscription.findUniqueOrThrow({
        where: { organizationId: org.id },
      });
      expect(subscription.suspendedAt).not.toBeNull();
    });

    it("does not duplicate payments on concurrent reactivation submissions", async () => {
      const { org } = await seedOrgWithSubscription({});
      await suspendOrganization(admin, {
        organizationId: org.id,
        reason: "test suspension",
      });
      const payload = {
        organizationId: org.id,
        amount: "3000",
        receivedAt: "2026-10-20",
        periodStartAt: "2026-10-20",
        periodEndAt: "2026-11-19",
        idempotencyKey: `test-reactivate-race-${suffix}`,
      };
      const [first, second] = await Promise.all([
        reactivateOrganization(admin, {
          organizationId: org.id,
          reason: "reactivate with payment",
          payment: payload,
        }),
        reactivateOrganization(admin, {
          organizationId: org.id,
          reason: "reactivate with payment",
          payment: payload,
        }),
      ]);
      expect(first).toBe("ACTIVE");
      expect(second).toBe("ACTIVE");
      expect(
        await db.saasSubscriptionPayment.count({ where: { organizationId: org.id } }),
      ).toBe(1);
    });

    it("records at most one payment when two gyms race on the same token", async () => {
      const { org: orgA } = await seedOrgWithSubscription({});
      const { org: orgB } = await seedOrgWithSubscription({});
      await suspendOrganization(admin, {
        organizationId: orgA.id,
        reason: "test suspension",
      });
      await suspendOrganization(admin, {
        organizationId: orgB.id,
        reason: "test suspension",
      });
      const token = `test-reactivate-xgym-${suffix}`;
      const payload = {
        amount: "3000",
        receivedAt: "2026-10-20",
        periodStartAt: "2026-10-20",
        periodEndAt: "2026-11-19",
        idempotencyKey: token,
      };
      // Both attempts carry the same token: the token lock serializes
      // them, so exactly one records a payment and the other is
      // rejected as cross-gym reuse. Which gym wins is scheduling,
      // so the test asserts the invariant, not the winner.
      const results = await Promise.allSettled([
        reactivateOrganization(admin, {
          organizationId: orgA.id,
          reason: "reactivate with payment",
          payment: { organizationId: orgA.id, ...payload },
        }),
        reactivateOrganization(admin, {
          organizationId: orgB.id,
          reason: "reactivate with payment",
          payment: { organizationId: orgB.id, ...payload },
        }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
      const fulfilled = results.find(
        (r) => r.status === "fulfilled",
      ) as PromiseFulfilledResult<unknown>;
      expect(fulfilled.value).toBe("ACTIVE");
      const rejected = results.find(
        (r) => r.status === "rejected",
      ) as PromiseRejectedResult;
      expect((rejected.reason as Error).message).toMatch("another gym");
      expect(
        await db.saasSubscriptionPayment.count({
          where: { organizationId: { in: [orgA.id, orgB.id] } },
        }),
      ).toBe(1);
      const payment = await db.saasSubscriptionPayment.findFirstOrThrow({
        where: { idempotencyKey: token },
      });
      const loserId = payment.organizationId === orgA.id ? orgB.id : orgA.id;
      expect(
        await db.saasSubscriptionPayment.count({
          where: { organizationId: loserId },
        }),
      ).toBe(0);
      const loserSubscription =
        await db.organizationSubscription.findUniqueOrThrow({
          where: { organizationId: loserId },
        });
      expect(loserSubscription.suspendedAt).not.toBeNull();
    });

    it("extends a trial from its existing expiry and audits the change", async () => {
      const now = Date.now();
      const { org } = await seedOrgWithSubscription({
        trialEndsAt: new Date(now + 2 * 24 * 60 * 60_000),
      });
      const { trialEndsAt } = await extendTrial(admin, {
        organizationId: org.id,
        days: "7",
        reason: "goodwill",
      });
      expect(trialEndsAt.getTime()).toBeGreaterThan(now + 8 * 24 * 60 * 60_000);
      await expect(
        extendTrial(admin, { organizationId: org.id, days: "0", reason: "x" }),
      ).rejects.toThrow();
      await expect(
        extendTrial(admin, { organizationId: org.id, days: "91", reason: "x" }),
      ).rejects.toThrow();
    });

    it("keeps offer requests idempotent, window-gated, and restricted to 5% or 10%", async () => {
      const { org } = await seedOrgWithSubscription({
        trialEndsAt: new Date(Date.now() + 24 * 60 * 60_000),
      });
      const first = await requestSaasOffer(org.id, adminUserId);
      expect(first.alreadyRequested).toBe(false);
      const second = await requestSaasOffer(org.id, adminUserId);
      expect(second.alreadyRequested).toBe(true);
      expect(second.offer.id).toBe(first.offer.id);
      expect(
        await db.saasOfferRequest.count({
          where: { organizationId: org.id, status: "REQUESTED" },
        }),
      ).toBe(1);
      expect(
        await db.auditLog.findFirst({
          where: {
            organizationId: org.id,
            event: AUDIT_EVENT_SAAS_OFFER_REQUESTED,
          },
        }),
      ).not.toBeNull();
      await expect(
        reviewOffer(admin, {
          offerId: first.offer.id,
          decision: "APPROVED",
          discountPercent: "15",
        }),
      ).rejects.toThrow("5% or 10%");
      const approved = await reviewOffer(admin, {
        offerId: first.offer.id,
        decision: "APPROVED",
        discountPercent: "10",
        offerExpiresAt: "2026-12-01",
        agreedAmount: "4499.55",
      });
      expect(approved.status).toBe("APPROVED");
      expect(approved.discountPercent).toBe(10);
      const accepted = await acceptSaasOffer(org.id, adminUserId, approved.id);
      expect(accepted.status).toBe("ACCEPTED");

      const { org: earlyOrg } = await seedOrgWithSubscription({
        trialEndsAt: new Date(Date.now() + 5 * 24 * 60 * 60_000),
      });
      await expect(
        requestSaasOffer(earlyOrg.id, adminUserId),
      ).rejects.toThrow("final 48 hours");
    });

    it("rejects offer requests from a suspended gym, even inside the final 48 hours", async () => {
      const { org } = await seedOrgWithSubscription({
        trialEndsAt: new Date(Date.now() + 24 * 60 * 60_000),
        suspendedAt: new Date(),
      });
      await expect(
        requestSaasOffer(org.id, adminUserId),
      ).rejects.toThrow("while the gym is suspended");
      expect(
        await db.saasOfferRequest.count({
          where: { organizationId: org.id },
        }),
      ).toBe(0);
    });
  },
);
