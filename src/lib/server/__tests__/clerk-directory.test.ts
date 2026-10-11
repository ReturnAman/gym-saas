import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Clerk directory seam: the ONLY caller of the Clerk Backend API
 * for staff account resolution. These tests pin the trust rules against
 * a mocked Clerk client — above all that the provider's email filter is
 * treated as a candidate filter only: an account counts solely when it
 * owns the queried address EXACTLY and that address is VERIFIED.
 */

const { mockGetUserList } = vi.hoisted(() => ({
  mockGetUserList: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    users: { getUserList: mockGetUserList },
  }),
}));

import {
  ClerkDirectoryUnavailableError,
  findClerkDisplayNamesById,
  findClerkUserByVerifiedEmail,
} from "@/lib/server/clerk-directory";

function clerkUser(
  id: string,
  addresses: { emailAddress: string; status?: string }[],
  firstName: string | null = "Pat",
  lastName: string | null = "Example",
) {
  return {
    id,
    firstName,
    lastName,
    emailAddresses: addresses.map((a) => ({
      emailAddress: a.emailAddress,
      verification: a.status ? { status: a.status } : null,
    })),
  };
}

function listResponse(users: unknown[]) {
  return { data: users, totalCount: users.length };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findClerkUserByVerifiedEmail", () => {
  it("resolves the account owning the exact address as verified", async () => {
    mockGetUserList.mockResolvedValue(
      listResponse([
        clerkUser("user_1", [
          { emailAddress: "person@example.com", status: "verified" },
        ]),
      ]),
    );
    const result = await findClerkUserByVerifiedEmail("person@example.com");
    expect(result).toEqual({
      clerkUserId: "user_1",
      displayName: "Pat Example",
    });
    expect(mockGetUserList).toHaveBeenCalledWith({
      emailAddress: ["person@example.com"],
      limit: 100,
    });
  });

  it("rejects partial matches the provider filter may return", async () => {
    mockGetUserList.mockResolvedValue(
      listResponse([
        clerkUser("user_1", [
          { emailAddress: "person@example.com.evil.test", status: "verified" },
        ]),
        clerkUser("user_2", [
          { emailAddress: "a-person@example.com", status: "verified" },
        ]),
      ]),
    );
    expect(
      await findClerkUserByVerifiedEmail("person@example.com"),
    ).toBeNull();
  });

  it("rejects an exact address that is not verified", async () => {
    mockGetUserList.mockResolvedValue(
      listResponse([
        clerkUser("user_1", [
          { emailAddress: "person@example.com", status: "unverified" },
        ]),
        clerkUser("user_2", [{ emailAddress: "person@example.com" }]),
      ]),
    );
    expect(
      await findClerkUserByVerifiedEmail("person@example.com"),
    ).toBeNull();
  });

  it("returns null when two accounts own the address verified", async () => {
    mockGetUserList.mockResolvedValue(
      listResponse([
        clerkUser("user_1", [
          { emailAddress: "person@example.com", status: "verified" },
        ]),
        clerkUser("user_2", [
          { emailAddress: "Person@Example.com", status: "verified" },
        ]),
      ]),
    );
    expect(
      await findClerkUserByVerifiedEmail("person@example.com"),
    ).toBeNull();
  });

  it("throws the typed unavailable error when the provider fails", async () => {
    mockGetUserList.mockRejectedValue(new Error("provider down"));
    await expect(
      findClerkUserByVerifiedEmail("person@example.com"),
    ).rejects.toBeInstanceOf(ClerkDirectoryUnavailableError);
  });
});

describe("findClerkDisplayNamesById", () => {
  it("maps Clerk IDs to joined display names", async () => {
    mockGetUserList.mockResolvedValue(
      listResponse([
        clerkUser("user_1", [], "Asha", "Rao"),
        clerkUser("user_2", [], null, null),
      ]),
    );
    const names = await findClerkDisplayNamesById(["user_1", "user_2"]);
    expect(names.get("user_1")).toBe("Asha Rao");
    expect(names.get("user_2")).toBeNull();
    expect(mockGetUserList).toHaveBeenCalledWith({
      userId: ["user_1", "user_2"],
      limit: 100,
    });
  });

  it("degrades to an empty map when the provider fails (display only)", async () => {
    mockGetUserList.mockRejectedValue(new Error("provider down"));
    const names = await findClerkDisplayNamesById(["user_1"]);
    expect(names.size).toBe(0);
  });

  it("does not call the provider for an empty ID set", async () => {
    const names = await findClerkDisplayNamesById([]);
    expect(names.size).toBe(0);
    expect(mockGetUserList).not.toHaveBeenCalled();
  });
});
