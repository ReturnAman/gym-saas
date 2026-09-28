import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockTransaction, mockOrgCreate, mockMembershipCreate, mockRequireCurrentUser } =
  vi.hoisted(() => {
    const mockOrgCreate = vi.fn();
    const mockMembershipCreate = vi.fn();
    const mockTransaction = vi.fn();
    const mockRequireCurrentUser = vi.fn();
    return {
      mockTransaction,
      mockOrgCreate,
      mockMembershipCreate,
      mockRequireCurrentUser,
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

import { redirect } from "next/navigation";
import { createOrganizationAction } from "@/app/onboarding/actions";
import {
  createOrganization,
  MAX_ORGANIZATION_NAME_LENGTH,
} from "@/lib/server/organizations";

const USER_ID = "b2198c2a-f96e-22da-cd1a-00222444be2e";

const appUser = { id: USER_ID } as never;

const createdOrg = {
  id: "c3298d3b-a07f-33eb-de2b-00333455cf3f",
  name: "Iron Works Gym",
};

function mockSuccessfulTransaction() {
  mockOrgCreate.mockResolvedValue(createdOrg);
  mockMembershipCreate.mockResolvedValue({ role: "OWNER" });
  mockTransaction.mockImplementation(async (cb: never) =>
    (cb as (tx: unknown) => Promise<unknown>)({
      organization: { create: mockOrgCreate },
      organizationMembership: { create: mockMembershipCreate },
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

    await expect(createOrganizationAction(formData)).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("creates the gym for the authenticated user and redirects to the organization's area", async () => {
    mockRequireCurrentUser.mockResolvedValue(appUser);
    mockSuccessfulTransaction();

    const formData = new FormData();
    formData.set("name", "Iron Works Gym");

    // Success ends in redirect("/app/org"), which throws NEXT_REDIRECT.
    const error = await createOrganizationAction(formData).catch(
      (err: unknown) => err,
    );
    expect((error as { digest?: string }).digest).toContain("/app/org");

    expect(mockOrgCreate).toHaveBeenCalledWith({
      data: { name: "Iron Works Gym" },
    });
    const membershipData = mockMembershipCreate.mock.calls[0]![0].data;
    expect(membershipData).toMatchObject({ userId: USER_ID, role: "OWNER" });
  });
});
