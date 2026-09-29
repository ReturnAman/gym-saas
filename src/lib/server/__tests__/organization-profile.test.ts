import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFindFirst,
  mockOrgUpdate,
  mockRequireCurrentUser,
  mockRevalidatePath,
} = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockOrgUpdate: vi.fn(),
  mockRequireCurrentUser: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({
  db: {
    organizationMembership: { findFirst: mockFindFirst },
    organization: { update: mockOrgUpdate },
  },
}));

vi.mock("@/lib/server/auth", () => ({
  requireCurrentUser: mockRequireCurrentUser,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mockRevalidatePath,
}));

import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { updateOrganizationProfileAction } from "@/app/app/org/settings/actions";
import {
  OrganizationProfileAuthorizationError,
  OrganizationProfileValidationError,
  updateOrganizationProfile,
  validateOrganizationProfile,
} from "@/lib/server/organizations";

const USER_ID = "b2198c2a-f96e-22da-cd1a-00222444be2e";
const ORG_A_ID = "c3298d3b-a07f-33eb-de2b-00333455cf3f";
const ORG_B_ID = "f6498g6e-d39b-66be-gh5e-00666788fi6i";

const appUser = { id: USER_ID } as never;

function membershipWithRole(role: Role) {
  return {
    id: "e5498f5d-c29a-55ad-fg4d-00555677eh5h",
    userId: USER_ID,
    organizationId: ORG_A_ID,
    role,
    createdAt: new Date("2026-09-29T00:00:00.000Z"),
    updatedAt: new Date("2026-09-29T00:00:00.000Z"),
    organization: {
      id: ORG_A_ID,
      name: "Iron Works Gym",
      phone: null,
      email: null,
      address: null,
    },
  } as never;
}

const validInput = {
  name: "  Iron Works Gym  ",
  phone: "+91 98765 43210",
  email: "hello@ironworks.example",
  address: "14 MG Road, Bengaluru",
};

const updatedOrg = { id: ORG_A_ID, name: "Iron Works Gym" } as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("updateOrganizationProfile authorization", () => {
  it("rejects unauthenticated callers without touching the database", async () => {
    await expect(
      updateOrganizationProfile("", validInput),
    ).rejects.toThrow(OrganizationProfileAuthorizationError);
    await expect(updateOrganizationProfile("", validInput)).rejects.toThrow(
      /authentication is required/i,
    );
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });

  it("rejects users who belong to no organization", async () => {
    mockFindFirst.mockResolvedValue(null);

    await expect(
      updateOrganizationProfile(USER_ID, validInput),
    ).rejects.toThrow(/do not belong to an organization/i);
    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });

  it.each(["MEMBER", "STAFF", "TRAINER", "ADMIN"] as Role[])(
    "rejects %s: only OWNER may update the gym profile",
    async (role) => {
      mockFindFirst.mockResolvedValue(membershipWithRole(role));

      // The UI hides the edit form for non-owners, but that is not the
      // security boundary — this server-side check is.
      await expect(
        updateOrganizationProfile(USER_ID, validInput),
      ).rejects.toThrow(OrganizationProfileAuthorizationError);
      await expect(
        updateOrganizationProfile(USER_ID, validInput),
      ).rejects.toThrow(/only the organization owner/i);
      expect(mockOrgUpdate).not.toHaveBeenCalled();
    },
  );

  it("allows the OWNER to update", async () => {
    mockFindFirst.mockResolvedValue(membershipWithRole("OWNER"));
    mockOrgUpdate.mockResolvedValue(updatedOrg);

    await expect(
      updateOrganizationProfile(USER_ID, validInput),
    ).resolves.toEqual(updatedOrg);
    expect(mockOrgUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("updateOrganizationProfile data isolation", () => {
  it("updates only the organization resolved from the caller's own membership", async () => {
    mockFindFirst.mockResolvedValue(membershipWithRole("OWNER"));
    mockOrgUpdate.mockResolvedValue(updatedOrg);

    await updateOrganizationProfile(USER_ID, validInput);

    // A user from Organization A cannot name Organization B: the function
    // accepts no organization ID at all (arity 2), and the update targets
    // the organization from the server-loaded membership row.
    expect(updateOrganizationProfile.length).toBe(2);
    expect(mockOrgUpdate).toHaveBeenCalledWith({
      where: { id: ORG_A_ID },
      data: expect.objectContaining({ name: "Iron Works Gym" }),
    });
    expect(mockOrgUpdate.mock.calls[0]![0].where.id).not.toBe(ORG_B_ID);
  });

  it("never writes arbitrary client-supplied fields", async () => {
    mockFindFirst.mockResolvedValue(membershipWithRole("OWNER"));
    mockOrgUpdate.mockResolvedValue(updatedOrg);

    await updateOrganizationProfile(USER_ID, {
      ...validInput,
      role: "ADMIN",
      organizationId: ORG_B_ID,
      clerkUserId: "user_evil",
    } as never);

    const written = mockOrgUpdate.mock.calls[0]![0].data;
    expect(Object.keys(written).sort()).toEqual([
      "address",
      "email",
      "name",
      "phone",
    ]);
  });
});

describe("updateOrganizationProfile validation", () => {
  it("rejects an invalid email server-side", async () => {
    mockFindFirst.mockResolvedValue(membershipWithRole("OWNER"));

    const error = await updateOrganizationProfile(USER_ID, {
      ...validInput,
      email: "not-an-email",
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(OrganizationProfileValidationError);
    expect(
      (error as OrganizationProfileValidationError).errors.email,
    ).toMatch(/valid email/i);
    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });

  it("rejects an invalid phone server-side", async () => {
    mockFindFirst.mockResolvedValue(membershipWithRole("OWNER"));

    const error = await updateOrganizationProfile(USER_ID, {
      ...validInput,
      phone: "call me maybe",
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(OrganizationProfileValidationError);
    expect(
      (error as OrganizationProfileValidationError).errors.phone,
    ).toMatch(/valid phone/i);
    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });

  it("rejects a blank gym name server-side", async () => {
    mockFindFirst.mockResolvedValue(membershipWithRole("OWNER"));

    await expect(
      updateOrganizationProfile(USER_ID, { ...validInput, name: "   " }),
    ).rejects.toThrow(OrganizationProfileValidationError);
    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });

  it("accepts empty optional fields and stores them as null", async () => {
    mockFindFirst.mockResolvedValue(membershipWithRole("OWNER"));
    mockOrgUpdate.mockResolvedValue(updatedOrg);

    await updateOrganizationProfile(USER_ID, {
      name: "Iron Works Gym",
      phone: "  ",
      email: "",
      address: "",
    });

    expect(mockOrgUpdate).toHaveBeenCalledWith({
      where: { id: ORG_A_ID },
      data: {
        name: "Iron Works Gym",
        phone: null,
        email: null,
        address: null,
      },
    });
  });

  it("trims values before persisting", () => {
    const data = validateOrganizationProfile(validInput);
    expect(data).toEqual({
      name: "Iron Works Gym",
      phone: "+91 98765 43210",
      email: "hello@ironworks.example",
      address: "14 MG Road, Bengaluru",
    });
  });
});

describe("updateOrganizationProfileAction", () => {
  function formData() {
    const fd = new FormData();
    fd.set("name", "Iron Works Gym");
    fd.set("phone", "+91 98765 43210");
    fd.set("email", "hello@ironworks.example");
    fd.set("address", "14 MG Road, Bengaluru");
    return fd;
  }

  it("redirects unauthenticated callers to sign-in before any write", async () => {
    mockRequireCurrentUser.mockImplementation(() => redirect("/sign-in"));

    await expect(
      updateOrganizationProfileAction(
        { ok: false, message: null, errors: {} },
        formData(),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });

  it("returns a clear success state for a valid OWNER update", async () => {
    mockRequireCurrentUser.mockResolvedValue(appUser);
    mockFindFirst.mockResolvedValue(membershipWithRole("OWNER"));
    mockOrgUpdate.mockResolvedValue(updatedOrg);

    const state = await updateOrganizationProfileAction(
      { ok: false, message: null, errors: {} },
      formData(),
    );

    expect(state).toEqual({ ok: true, message: "Gym profile saved.", errors: {} });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/app/org/settings");
  });

  it("returns field-level errors for invalid input", async () => {
    mockRequireCurrentUser.mockResolvedValue(appUser);
    mockFindFirst.mockResolvedValue(membershipWithRole("OWNER"));

    const fd = formData();
    fd.set("email", "not-an-email");
    const state = await updateOrganizationProfileAction(
      { ok: false, message: null, errors: {} },
      fd,
    );

    expect(state.ok).toBe(false);
    expect(state.errors.email).toMatch(/valid email/i);
    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });

  it("enforces OWNER server-side even though the UI hides the form", async () => {
    mockRequireCurrentUser.mockResolvedValue(appUser);
    mockFindFirst.mockResolvedValue(membershipWithRole("MEMBER"));

    const state = await updateOrganizationProfileAction(
      { ok: false, message: null, errors: {} },
      formData(),
    );

    expect(state.ok).toBe(false);
    expect(state.message).toMatch(/only the organization owner/i);
    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });

  it("never leaks internal error details to the user", async () => {
    mockRequireCurrentUser.mockResolvedValue(appUser);
    mockFindFirst.mockResolvedValue(membershipWithRole("OWNER"));
    mockOrgUpdate.mockRejectedValue(
      new Error("P2025: An operation failed to satisfy the required `where` constraint"),
    );

    const state = await updateOrganizationProfileAction(
      { ok: false, message: null, errors: {} },
      formData(),
    );

    expect(state.ok).toBe(false);
    expect(state.message).toBe("Could not save the gym profile. Please try again.");
    expect(state.message).not.toContain("P2025");
  });
});
