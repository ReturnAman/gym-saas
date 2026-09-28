import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetCurrentUser, mockFindMany, mockFindFirst, mockFindUnique } =
  vi.hoisted(() => ({
    mockGetCurrentUser: vi.fn(),
    mockFindMany: vi.fn(),
    mockFindFirst: vi.fn(),
    mockFindUnique: vi.fn(),
  }));

vi.mock("@/lib/server/db", () => ({
  db: {
    organizationMembership: {
      findMany: mockFindMany,
      findFirst: mockFindFirst,
      findUnique: mockFindUnique,
    },
  },
}));

vi.mock("@/lib/server/auth", () => ({
  getCurrentUser: mockGetCurrentUser,
}));

import {
  getPrimaryMembership,
  getUserMemberships,
  hasRole,
  requireOrganizationContext,
  requireOrganizationMembership,
} from "@/lib/server/authorization";

const USER_ID = "b2198c2a-f96e-22da-cd1a-00222444be2e";
const OTHER_USER_ID = "d4398e4c-b18f-44fc-ef3c-00444566dg4g";
const ORG_ID = "c3298d3b-a07f-33eb-de2b-00333455cf3f";

const appUser = { id: USER_ID } as never;

const organization = { id: ORG_ID, name: "Iron Works Gym" } as never;

const ownerMembership = {
  id: "e5498f5d-c29a-55ad-fg4d-00555677eh5h",
  userId: USER_ID,
  organizationId: ORG_ID,
  role: "OWNER",
  organization,
} as never;

/** Assert the promise rejects via Next.js redirect() to the given path. */
async function expectRedirectTo(promise: Promise<unknown>, path: string) {
  const error = await promise.then(
    () => {
      throw new Error("expected a redirect, but the promise resolved");
    },
    (err: unknown) => err,
  );
  expect((error as { digest?: string }).digest).toContain(path);
  expect((error as { digest?: string }).digest).toContain("NEXT_REDIRECT");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getUserMemberships", () => {
  it("determines the user's organization memberships from server-side data", async () => {
    mockFindMany.mockResolvedValue([ownerMembership]);

    const memberships = await getUserMemberships(USER_ID);

    expect(mockFindMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      include: { organization: true },
      orderBy: { createdAt: "asc" },
    });
    expect(memberships).toEqual([ownerMembership]);
    // Each membership carries its organization, resolved server-side.
    expect(memberships[0]!.organization.name).toBe("Iron Works Gym");
  });
});

describe("getPrimaryMembership", () => {
  it("returns the user's membership when they belong to an organization", async () => {
    mockFindFirst.mockResolvedValue(ownerMembership);

    // The onboarding page redirects to /app/org when this is non-null, so
    // an existing member is never shown first-time onboarding again.
    await expect(getPrimaryMembership(USER_ID)).resolves.toEqual(
      ownerMembership,
    );
  });

  it("returns null for a user with no organization (first-time onboarding)", async () => {
    mockFindFirst.mockResolvedValue(null);

    await expect(getPrimaryMembership(USER_ID)).resolves.toBeNull();
  });
});

describe("requireOrganizationMembership", () => {
  it("returns the membership when the user belongs to the organization", async () => {
    mockFindUnique.mockResolvedValue(ownerMembership);

    const membership = await requireOrganizationMembership(USER_ID, ORG_ID);

    // The lookup is scoped to the user's own membership rows via the
    // composite unique key — the organization ID is only a lookup key,
    // never proof of authorization on its own.
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { userId_organizationId: { userId: USER_ID, organizationId: ORG_ID } },
      include: { organization: true },
    });
    expect(membership).toEqual(ownerMembership);
  });

  it("never exposes another organization's data to an unauthorized user", async () => {
    // This user has NO membership row for the organization: the lookup
    // finds nothing, so they are redirected away without any data.
    mockFindUnique.mockResolvedValue(null);

    await expectRedirectTo(
      requireOrganizationMembership(OTHER_USER_ID, ORG_ID),
      "/app",
    );
  });
});

describe("hasRole", () => {
  it("checks the role from the server-loaded membership row", () => {
    expect(hasRole(ownerMembership, "OWNER")).toBe(true);
    expect(hasRole(ownerMembership, "ADMIN", "OWNER")).toBe(true);
    expect(hasRole(ownerMembership, "ADMIN")).toBe(false);
    expect(hasRole(ownerMembership, "MEMBER")).toBe(false);
  });
});

describe("requireOrganizationContext", () => {
  it("redirects unauthenticated visitors to sign-in", async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    await expectRedirectTo(requireOrganizationContext(), "/sign-in");
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("redirects users with no organization to onboarding", async () => {
    mockGetCurrentUser.mockResolvedValue(appUser);
    mockFindFirst.mockResolvedValue(null);

    await expectRedirectTo(requireOrganizationContext(), "/onboarding");
  });

  it("derives the organization from server-side membership data, never client input", async () => {
    mockGetCurrentUser.mockResolvedValue(appUser);
    mockFindFirst.mockResolvedValue(ownerMembership);

    const context = await requireOrganizationContext();

    expect(context.user).toEqual(appUser);
    expect(context.membership).toEqual(ownerMembership);
    expect(context.organization).toEqual(organization);
    expect(context.organization.name).toBe("Iron Works Gym");
  });
});
