import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Platform-admin overview — service unit tests (mocked Prisma).
 *
 * Pins the Phase 12 hardening contract for getPlatformAdminOverview:
 * - totalOrganizations counts organization rows (db.organization.count),
 *   including organizations with no subscription row;
 * - a missing subscription row resolves to PENDING_PAYMENT, so those
 *   organizations also count toward awaitingPayment;
 * - the list is bounded to ADMIN_OVERVIEW_PAGE_SIZE rows per page with
 *   a stable (createdAt desc, id desc) order, totalMatching counts the
 *   same search filter across all pages, and out-of-range pages are
 *   empty (the members-list convention);
 * - search narrows the list, never the global metrics.
 *
 * The mocked findMany honours the where/orderBy/skip/take it is given,
 * so these tests exercise the service's own pagination and metrics
 * logic rather than the mock's. Behaviour against a real database is
 * covered by platform-admin-overview-db.test.ts.
 */

const { mockOrgFindMany, mockOrgCount, mockSubFindMany } = vi.hoisted(
  () => ({
    mockOrgFindMany: vi.fn(),
    mockOrgCount: vi.fn(),
    mockSubFindMany: vi.fn(),
  }),
);

vi.mock("@/lib/server/db", () => ({
  db: {
    organization: { findMany: mockOrgFindMany, count: mockOrgCount },
    organizationSubscription: { findMany: mockSubFindMany },
  },
}));

vi.mock("@/lib/server/clerk-directory", () => ({
  findClerkDisplayNamesById: vi.fn(async () => new Map<string, string>()),
}));

vi.mock("@/lib/server/auth", () => ({
  getCurrentUser: vi.fn(),
}));

import {
  ADMIN_OVERVIEW_PAGE_SIZE,
  getPlatformAdminOverview,
} from "@/lib/server/platform-admin";

interface FakeSubscription {
  suspendedAt: Date | null;
  paidThroughAt: Date | null;
  trialEndsAt: Date | null;
}

interface FakeOrg {
  id: string;
  name: string;
  createdAt: Date;
  subscription: FakeSubscription | null;
}

const DAY_MS = 24 * 60 * 60_000;
let orgs: FakeOrg[] = [];

function trialSubscription(): FakeSubscription {
  return {
    suspendedAt: null,
    paidThroughAt: null,
    trialEndsAt: new Date(Date.now() + 3 * DAY_MS),
  };
}

function pendingSubscription(): FakeSubscription {
  return { suspendedAt: null, paidThroughAt: null, trialEndsAt: null };
}

function fakeOrg(
  id: string,
  name: string,
  subscription: FakeSubscription | null,
  createdAt: Date = new Date(),
): FakeOrg {
  return { id, name, createdAt, subscription };
}

function matchesWhere(org: FakeOrg, where: unknown): boolean {
  const contains = (
    where as { name?: { contains?: string } } | undefined
  )?.name?.contains;
  if (!contains) return true;
  return org.name.toLowerCase().includes(contains.toLowerCase());
}

beforeEach(() => {
  orgs = [];
  mockOrgFindMany.mockReset();
  mockOrgCount.mockReset();
  mockSubFindMany.mockReset();

  mockOrgFindMany.mockImplementation(async (args: {
    where?: unknown;
    orderBy?: { createdAt?: string; id?: string }[];
    skip?: number;
    take?: number;
  }) => {
    const rows = orgs.filter((org) => matchesWhere(org, args?.where));
    const orderBy = args?.orderBy ?? [];
    rows.sort((a, b) => {
      for (const key of orderBy) {
        for (const [field, direction] of Object.entries(key)) {
          const av = a[field as keyof FakeOrg];
          const bv = b[field as keyof FakeOrg];
          const cmp =
            av instanceof Date && bv instanceof Date
              ? av.getTime() - bv.getTime()
              : String(av) < String(bv)
                ? -1
                : String(av) > String(bv)
                  ? 1
                  : 0;
          if (cmp !== 0) return direction === "desc" ? -cmp : cmp;
        }
      }
      return 0;
    });
    const skip = args?.skip ?? 0;
    const take = args?.take ?? rows.length;
    return rows.slice(skip, skip + take).map((org) => ({
      id: org.id,
      name: org.name,
      createdAt: org.createdAt,
      subscription: org.subscription,
      memberships: [],
      saasOffers: [],
      saasPayments: [],
    }));
  });

  mockOrgCount.mockImplementation(async (args?: { where?: unknown }) =>
    orgs.filter((org) => matchesWhere(org, args?.where)).length,
  );

  mockSubFindMany.mockImplementation(async () =>
    orgs
      .filter((org) => org.subscription !== null)
      .map((org) => ({
        suspendedAt: org.subscription!.suspendedAt,
        paidThroughAt: org.subscription!.paidThroughAt,
        trialEndsAt: org.subscription!.trialEndsAt,
      })),
  );
});

describe("getPlatformAdminOverview metrics", () => {
  it("counts subscription-less organizations in the total and in awaiting payment", async () => {
    orgs = [
      fakeOrg("org-trial", "Trial Gym", trialSubscription()),
      fakeOrg("org-pending", "Pending Gym", pendingSubscription()),
      fakeOrg("org-bare-1", "Bare Gym One", null),
      fakeOrg("org-bare-2", "Bare Gym Two", null),
    ];

    const overview = await getPlatformAdminOverview("");

    expect(overview.metrics.totalOrganizations).toBe(4);
    // One PENDING_PAYMENT subscription row + two organizations with no
    // row at all (their resolved state is also PENDING_PAYMENT).
    expect(overview.metrics.awaitingPayment).toBe(3);
    expect(overview.metrics.activeTrials).toBe(1);
    expect(overview.metrics.expiredOrSuspended).toBe(0);
  });

  it("lists a subscription-less organization as PENDING_PAYMENT with a null subscription", async () => {
    orgs = [fakeOrg("org-bare", "Bare Gym", null)];

    const overview = await getPlatformAdminOverview("");

    expect(overview.organizations).toHaveLength(1);
    const row = overview.organizations[0];
    expect(row?.organization.id).toBe("org-bare");
    expect(row?.subscription).toBeNull();
    expect(row?.state).toBe("PENDING_PAYMENT");
  });

  it("keeps metrics global while search narrows the list and totalMatching", async () => {
    orgs = [
      fakeOrg("org-alpha", "Alpha Gym", trialSubscription()),
      fakeOrg("org-beta", "Beta Gym", pendingSubscription()),
      fakeOrg("org-annex", "Alpha Annex", null),
    ];

    const overview = await getPlatformAdminOverview("alpha");

    expect(
      overview.organizations.map((row) => row.organization.id).sort(),
    ).toEqual(["org-alpha", "org-annex"]);
    expect(overview.totalMatching).toBe(2);
    // Metrics still describe all three organizations.
    expect(overview.metrics.totalOrganizations).toBe(3);
    expect(overview.metrics.activeTrials).toBe(1);
    expect(overview.metrics.awaitingPayment).toBe(2);
  });
});

describe("getPlatformAdminOverview pagination", () => {
  function seedMany(count: number): void {
    const base = Date.UTC(2026, 0, 1);
    orgs = Array.from({ length: count }, (_, i) =>
      fakeOrg(
        `org-${String(i).padStart(3, "0")}`,
        `Gym ${i}`,
        pendingSubscription(),
        new Date(base + i * 60_000),
      ),
    );
  }

  it("returns exactly one page of 50, then the remainder", async () => {
    seedMany(51);

    const page1 = await getPlatformAdminOverview("", 1);
    expect(page1.organizations).toHaveLength(ADMIN_OVERVIEW_PAGE_SIZE);
    expect(page1.pageSize).toBe(50);
    expect(page1.totalMatching).toBe(51);
    expect(page1.totalPages).toBe(2);
    // Newest first.
    expect(page1.organizations[0]?.organization.id).toBe("org-050");

    const page2 = await getPlatformAdminOverview("", 2);
    expect(page2.organizations).toHaveLength(1);
    expect(page2.organizations[0]?.organization.id).toBe("org-000");

    const ids = new Set(
      [...page1.organizations, ...page2.organizations].map(
        (row) => row.organization.id,
      ),
    );
    expect(ids.size).toBe(51);
  });

  it("asks the database for a bounded slice (take 50, skip per page)", async () => {
    seedMany(51);

    await getPlatformAdminOverview("", 2);

    const listCall = mockOrgFindMany.mock.calls.at(-1)?.[0];
    expect(listCall.take).toBe(50);
    expect(listCall.skip).toBe(50);
    expect(listCall.orderBy).toEqual([
      { createdAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("breaks createdAt ties by id descending so pages are stable", async () => {
    const sameInstant = new Date(Date.UTC(2026, 5, 15, 10, 0, 0));
    orgs = [
      fakeOrg("org-b", "Gym B", pendingSubscription(), sameInstant),
      fakeOrg("org-a", "Gym A", pendingSubscription(), sameInstant),
      fakeOrg("org-c", "Gym C", pendingSubscription(), sameInstant),
    ];

    const overview = await getPlatformAdminOverview("");

    expect(
      overview.organizations.map((row) => row.organization.id),
    ).toEqual(["org-c", "org-b", "org-a"]);
  });

  it("returns an empty list for an out-of-range page", async () => {
    seedMany(3);

    const overview = await getPlatformAdminOverview("", 4);

    expect(overview.organizations).toEqual([]);
    expect(overview.totalMatching).toBe(3);
    expect(overview.page).toBe(4);
    expect(overview.totalPages).toBe(1);
  });

  it("treats a page below 1 as page 1", async () => {
    seedMany(3);

    const overview = await getPlatformAdminOverview("", 0);

    expect(overview.page).toBe(1);
    expect(overview.organizations).toHaveLength(3);
  });

  it("reports totalMatching with and without a search filter", async () => {
    orgs = [
      fakeOrg("org-1", "Alpha Gym", pendingSubscription()),
      fakeOrg("org-2", "Beta Gym", pendingSubscription()),
      fakeOrg("org-3", "Alpha Annex", pendingSubscription()),
    ];

    expect((await getPlatformAdminOverview("")).totalMatching).toBe(3);
    expect((await getPlatformAdminOverview("alpha")).totalMatching).toBe(2);
    expect((await getPlatformAdminOverview("zzz")).totalMatching).toBe(0);
  });
});
