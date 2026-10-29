import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockTransaction, mockOrgCreate, mockMembershipCreate, mockSubscriptionCreate, mockRequireCurrentUser, mockGetVerifiedPhones } =
  vi.hoisted(() => {
    const mockOrgCreate = vi.fn();
    const mockMembershipCreate = vi.fn();
    const mockSubscriptionCreate = vi.fn();
    const mockTransaction = vi.fn();
    const mockRequireCurrentUser = vi.fn();
    const mockGetVerifiedPhones = vi.fn();
    return {
      mockTransaction,
      mockOrgCreate,
      mockMembershipCreate,
      mockSubscriptionCreate,
      mockRequireCurrentUser,
      mockGetVerifiedPhones,
    };
  });

vi.mock("@/lib/server/db", () => ({
  db: {
    $transaction: mockTransaction,
  },
}));

vi.mock("@/lib/server/auth", () => ({
  requireCurrentUser: mockRequireCurrentUser,
}));

// Only the Clerk Backend API call is mocked. The pure match helper
// (findMatchingVerifiedPhone, in saas-phone.ts) runs for real, so a
// test that passes a matching verified number exercises the actual
// comparison.
vi.mock("@/lib/server/clerk-verified-phone", () => ({
  getVerifiedPhoneNumbersForClerkUser: mockGetVerifiedPhones,
}));

import { redirect } from "next/navigation";
import { createOrganizationAction } from "@/app/onboarding/actions";
import {
  createOrganization,
  MAX_ORGANIZATION_NAME_LENGTH,
} from "@/lib/server/organizations";

const USER_ID = "b2198c2a-f96e-22da-cd1a-00222444be2e";
const CLERK_USER_ID = "user_clerk_1";

const appUser = { id: USER_ID, clerkUserId: CLERK_USER_ID } as never;

const createdOrg = {
  id: "c3298d3b-a07f-33eb-de2b-00333455cf3f",
  name: "Iron Works Gym",
};

function mockSuccessfulTransaction() {
  mockOrgCreate.mockResolvedValue(createdOrg);
  mockMembershipCreate.mockResolvedValue({ role: "OWNER" });
  mockSubscriptionCreate.mockResolvedValue({ id: "subscription-1" });
  mockTransaction.mockImplementation(async (cb: never) =>
    (cb as (tx: unknown) => Promise<unknown>)({
      organization: { create: mockOrgCreate },
      organizationMembership: { create: mockMembershipCreate },
      organizationSubscription: { create: mockSubscriptionCreate },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createOrganization", () => {
  it("requires authentication: rejects an empty user ID without touching the database", async () => {
    await expect(
      createOrganization("", { name: "Iron Works Gym" }),
    ).rejects.toThrow(/authentication/i);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects a blank gym name", async () => {
    await expect(
      createOrganization(USER_ID, { name: "   " }),
    ).rejects.toThrow(/gym name is required/i);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects an overlong gym name", async () => {
    await expect(
      createOrganization(USER_ID, { name: "x".repeat(MAX_ORGANIZATION_NAME_LENGTH + 1) }),
    ).rejects.toThrow(/at most/);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("creates the organization and the OWNER membership atomically in one transaction", async () => {
    mockSuccessfulTransaction();

    const org = await createOrganization(USER_ID, { name: "  Iron Works Gym  " });

    // Atomicity: both writes happen inside a single $transaction callback,
    // so a failed membership insert can never leave an owner-less
    // organization behind (and vice versa).
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockOrgCreate).toHaveBeenCalledTimes(1);
    expect(mockOrgCreate).toHaveBeenCalledWith({
      data: { name: "Iron Works Gym" },
    });
    expect(mockMembershipCreate).toHaveBeenCalledTimes(1);
    expect(mockMembershipCreate).toHaveBeenCalledWith({
      data: {
        userId: USER_ID,
        organizationId: createdOrg.id,
        role: "OWNER",
      },
    });
    expect(org).toEqual(createdOrg);
  });

  it("grants the creating user the OWNER role", async () => {
    mockSuccessfulTransaction();

    await createOrganization(USER_ID, { name: "Iron Works Gym" });

    const membershipData = mockMembershipCreate.mock.calls[0]![0].data;
    expect(membershipData.role).toBe("OWNER");
    expect(membershipData.userId).toBe(USER_ID);
  });

  it("prevents duplicate memberships at the database level via a unique constraint", () => {
    // The (user_id, organization_id) unique constraint is what makes
    // "a user must not have duplicate membership in the same organization"
    // hold even under concurrent or repeated requests — the database
    // rejects the second insert regardless of application logic.
    const sql = readFileSync(
      join(
        process.cwd(),
        "prisma/migrations/20260928213000_add_organizations_and_memberships/migration.sql",
      ),
      "utf8",
    );
    expect(sql).toContain("CREATE UNIQUE INDEX");
    expect(sql).toContain('"user_id", "organization_id"');
  });
});

describe("createOrganizationAction", () => {
  it("does not allow unauthenticated creation: redirects to sign-in before any write", async () => {
    mockRequireCurrentUser.mockImplementation(() => redirect("/sign-in"));

    const formData = new FormData();
    formData.set("name", "Iron Works Gym");
    formData.set("phone", "9876543210");

    await expect(createOrganizationAction(formData)).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects a malformed phone without creating anything", async () => {
    mockRequireCurrentUser.mockResolvedValue(appUser);

    const formData = new FormData();
    formData.set("name", "Iron Works Gym");
    // Country code typed into the 10-digit field: rejected, not
    // stripped into an accepted number, and no gym is created.
    formData.set("phone", "+919876543210");

    const error = await createOrganizationAction(formData).catch(
      (err: unknown) => err,
    );
    expect((error as { digest?: string }).digest).toContain(
      "/onboarding?notice=",
    );
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockGetVerifiedPhones).not.toHaveBeenCalled();
  });

  it("fails closed when the Clerk phone lookup fails: no gym, no trial", async () => {
    mockRequireCurrentUser.mockResolvedValue(appUser);
    mockGetVerifiedPhones.mockRejectedValue(
      new Error("Phone verification is unavailable right now. Please try again."),
    );

    const formData = new FormData();
    formData.set("name", "Iron Works Gym");
    formData.set("phone", "9876543210");

    await expect(createOrganizationAction(formData)).rejects.toThrow(
      /Phone verification is unavailable/,
    );
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("creates the gym in PENDING_PAYMENT when the entered number matches no verified number", async () => {
    mockRequireCurrentUser.mockResolvedValue(appUser);
    mockGetVerifiedPhones.mockResolvedValue(["+919999999999"]);
    mockSuccessfulTransaction();

    const formData = new FormData();
    formData.set("name", "Iron Works Gym");
    formData.set("phone", "9876543210");

    // The redirect target is the subscription screen with an
    // explanation — not the organization's area.
    const error = await createOrganizationAction(formData).catch(
      (err: unknown) => err,
    );
    expect((error as { digest?: string }).digest).toContain(
      "/app/subscription?notice=",
    );

    expect(mockOrgCreate).toHaveBeenCalledWith({
      data: { name: "Iron Works Gym" },
    });
    const membershipData = mockMembershipCreate.mock.calls[0]![0].data;
    expect(membershipData).toMatchObject({ userId: USER_ID, role: "OWNER" });
    // No trial fields: the subscription row is the bare PENDING_PAYMENT
    // row, and the claim path was never entered (no verified match).
    expect(mockSubscriptionCreate).toHaveBeenCalledWith({
      data: { organizationId: createdOrg.id },
    });
  });

  it("grants the trial path when the entered number matches a verified Clerk number", async () => {
    mockRequireCurrentUser.mockResolvedValue(appUser);
    // Clerk reports the number with spacing; canonicalization must
    // still match the entered 10 digits.
    mockGetVerifiedPhones.mockResolvedValue(["+91 98765 43210"]);
    const mockExecuteRaw = vi.fn().mockResolvedValue(0);
    const mockClaimFindUnique = vi.fn().mockResolvedValue(null);
    const mockClaimCreate = vi.fn().mockResolvedValue({});
    const mockAuditCreate = vi.fn().mockResolvedValue({});
    mockOrgCreate.mockResolvedValue(createdOrg);
    mockMembershipCreate.mockResolvedValue({ role: "OWNER" });
    mockSubscriptionCreate.mockResolvedValue({ id: "subscription-1" });
    mockTransaction.mockImplementation(async (cb: never) =>
      (cb as (tx: unknown) => Promise<unknown>)({
        $executeRaw: mockExecuteRaw,
        organization: { create: mockOrgCreate },
        organizationMembership: { create: mockMembershipCreate },
        organizationSubscription: { create: mockSubscriptionCreate },
        saasTrialClaim: {
          findUnique: mockClaimFindUnique,
          create: mockClaimCreate,
        },
        auditLog: { create: mockAuditCreate },
      }),
    );

    const formData = new FormData();
    formData.set("name", "Iron Works Gym");
    formData.set("phone", "9876543210");

    const error = await createOrganizationAction(formData).catch(
      (err: unknown) => err,
    );
    expect((error as { digest?: string }).digest).toContain("/app/org");

    // The claim was attempted for exactly the matched canonical number.
    expect(mockClaimCreate).toHaveBeenCalledWith({
      data: {
        clerkUserId: CLERK_USER_ID,
        canonicalPhone: "+919876543210",
        organizationId: createdOrg.id,
      },
    });
    const subscriptionData = mockSubscriptionCreate.mock.calls[0]![0].data;
    expect(subscriptionData.trialStartedAt).toBeInstanceOf(Date);
    expect(subscriptionData.trialEndsAt).toBeInstanceOf(Date);
  });
});
