import crypto from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/server/db";
import {
  ADMIN_OVERVIEW_PAGE_SIZE,
  getPlatformAdminOverview,
  type AdminOverview,
} from "@/lib/server/platform-admin";
import {
  TRIAL_OFFER_WINDOW_MS,
  resolveEffectiveState,
} from "@/lib/server/subscriptions";

/**
 * Platform-admin overview against a real PostgreSQL database
 * (Phase 12 hardening).
 *
 * Covers what the mocked unit suite cannot: db.organization.count()
 * integration, skip/take pagination against real rows, and stable
 * ordering when organizations share a createdAt timestamp.
 *
 * Metrics are global (they describe the whole database), and other
 * suites share this database while it runs — so the metrics cases
 * verify the service against a direct census taken inside a stable
 * window (two bracketing census reads that agree), rather than
 * asserting absolute numbers. List behaviour is asserted exactly
 * through unique search tokens, which no other suite can match.
 *
 * Follows the saas-trial-db suite pattern: the suite skips unless
 * RUN_DB_TESTS=true (the test:db runner pins it).
 */

const DAY_MS = 24 * 60 * 60_000;

interface Census {
  totalOrganizations: number;
  activeTrials: number;
  awaitingPayment: number;
  expiringWithin48Hours: number;
  expiredOrSuspended: number;
}

async function readCensus(): Promise<Census> {
  const now = new Date();
  const [totalOrganizations, subscriptions] = await Promise.all([
    db.organization.count(),
    db.organizationSubscription.findMany({
      select: { suspendedAt: true, paidThroughAt: true, trialEndsAt: true },
    }),
  ]);
  const states = subscriptions.map((s) => resolveEffectiveState(s, now));
  const withoutSubscription = totalOrganizations - subscriptions.length;
  return {
    totalOrganizations,
    activeTrials: states.filter((s) => s === "TRIAL_ACTIVE").length,
    awaitingPayment:
      states.filter((s) => s === "PENDING_PAYMENT").length +
      withoutSubscription,
    expiringWithin48Hours: subscriptions.filter((s) => {
      const state = resolveEffectiveState(s, now);
      return (
        state === "TRIAL_ACTIVE" &&
        s.trialEndsAt !== null &&
        s.trialEndsAt.getTime() - now.getTime() <= TRIAL_OFFER_WINDOW_MS
      );
    }).length,
    expiredOrSuspended: states.filter(
      (s) => s === "EXPIRED" || s === "SUSPENDED",
    ).length,
  };
}

function censusesEqual(a: Census, b: Census): boolean {
  return (
    a.totalOrganizations === b.totalOrganizations &&
    a.activeTrials === b.activeTrials &&
    a.awaitingPayment === b.awaitingPayment &&
    a.expiringWithin48Hours === b.expiringWithin48Hours &&
    a.expiredOrSuspended === b.expiredOrSuspended
  );
}

/**
 * Call the overview between two census reads; when the census did not
 * move, the overview's metrics must equal it exactly. Retries a few
 * times so a concurrent suite's write cannot flake the assertion.
 */
async function overviewInStableWindow(): Promise<AdminOverview> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const before = await readCensus();
    const overview = await getPlatformAdminOverview("");
    const after = await readCensus();
    if (censusesEqual(before, after)) {
      expect(overview.metrics).toEqual(before);
      return overview;
    }
  }
  throw new Error("database census never stabilized for overview check");
}

describe.skipIf(process.env.RUN_DB_TESTS !== "true")(
  "platform-admin overview — database",
  () => {
    const suffix = crypto.randomUUID();
    const createdOrgIds: string[] = [];

    async function seedBareOrg(name: string, createdAt?: Date) {
      const org = await db.organization.create({
        data: { name, ...(createdAt ? { createdAt } : {}) },
        select: { id: true },
      });
      createdOrgIds.push(org.id);
      return org;
    }

    async function seedTrialOrg(name: string) {
      const org = await db.organization.create({
        data: { name },
        select: { id: true },
      });
      createdOrgIds.push(org.id);
      await db.organizationSubscription.create({
        data: {
          organizationId: org.id,
          trialStartedAt: new Date(Date.now() - DAY_MS),
          trialEndsAt: new Date(Date.now() + 6 * DAY_MS),
        },
      });
      return org;
    }

    beforeAll(async () => {
      await db.$queryRaw`SELECT 1`;
    });

    afterAll(async () => {
      if (createdOrgIds.length > 0) {
        await db.organizationSubscription.deleteMany({
          where: { organizationId: { in: createdOrgIds } },
        });
        await db.organization.deleteMany({
          where: { id: { in: createdOrgIds } },
        });
      }
      await db.$disconnect();
    });

    it("counts subscription-less organizations in the total and awaiting payment", async () => {
      // One trial gym and one gym with no subscription row at all.
      // While the bare gym exists, a total derived from subscription
      // rows cannot equal the organization census — so census equality
      // proves the bare gym is counted, as PENDING_PAYMENT.
      await seedTrialOrg(`Overview Trial ${suffix}`);
      await seedBareOrg(`Overview Bare ${suffix}`);

      await overviewInStableWindow();
    });

    it("lists a subscription-less organization as PENDING_PAYMENT", async () => {
      const bare = await seedBareOrg(`Overview Listed ${suffix}`);

      const overview = await getPlatformAdminOverview(
        `Overview Listed ${suffix}`,
      );

      expect(overview.totalMatching).toBe(1);
      expect(overview.organizations).toHaveLength(1);
      const row = overview.organizations[0];
      expect(row?.organization.id).toBe(bare.id);
      expect(row?.subscription).toBeNull();
      expect(row?.state).toBe("PENDING_PAYMENT");
    });

    it("keeps metrics identical when a search narrows the list", async () => {
      await seedBareOrg(`Overview Metrics ${suffix}`);

      for (let attempt = 0; attempt < 10; attempt++) {
        const unfiltered = await getPlatformAdminOverview("");
        const narrowed = await getPlatformAdminOverview(
          `Overview Metrics ${suffix}`,
        );
        const unfilteredAgain = await getPlatformAdminOverview("");
        if (
          JSON.stringify(unfiltered.metrics) ===
          JSON.stringify(unfilteredAgain.metrics)
        ) {
          expect(narrowed.metrics).toEqual(unfiltered.metrics);
          expect(narrowed.totalMatching).toBe(1);
          return;
        }
      }
      throw new Error("overview metrics never stabilized for search check");
    });

    it("paginates 51 matching gyms as 50 + 1 with no overlap", async () => {
      const token = `Overview Page ${suffix}`;
      for (let i = 0; i < ADMIN_OVERVIEW_PAGE_SIZE + 1; i++) {
        await seedBareOrg(`${token} ${i}`);
      }

      const page1 = await getPlatformAdminOverview(token, 1);
      expect(page1.totalMatching).toBe(ADMIN_OVERVIEW_PAGE_SIZE + 1);
      expect(page1.totalPages).toBe(2);
      expect(page1.organizations).toHaveLength(ADMIN_OVERVIEW_PAGE_SIZE);

      const page2 = await getPlatformAdminOverview(token, 2);
      expect(page2.organizations).toHaveLength(1);

      const ids = new Set(
        [...page1.organizations, ...page2.organizations].map(
          (row) => row.organization.id,
        ),
      );
      expect(ids.size).toBe(ADMIN_OVERVIEW_PAGE_SIZE + 1);

      const outOfRange = await getPlatformAdminOverview(token, 3);
      expect(outOfRange.organizations).toEqual([]);
      expect(outOfRange.totalMatching).toBe(ADMIN_OVERVIEW_PAGE_SIZE + 1);
    });

    it("orders gyms with identical createdAt by id descending", async () => {
      const token = `Overview Tie ${suffix}`;
      const sameInstant = new Date();
      const seeded = [
        await seedBareOrg(`${token} A`, sameInstant),
        await seedBareOrg(`${token} B`, sameInstant),
        await seedBareOrg(`${token} C`, sameInstant),
      ];
      const expected = seeded
        .map((org) => org.id)
        .sort()
        .reverse();

      const overview = await getPlatformAdminOverview(token);

      expect(
        overview.organizations.map((row) => row.organization.id),
      ).toEqual(expected);
    });
  },
);
