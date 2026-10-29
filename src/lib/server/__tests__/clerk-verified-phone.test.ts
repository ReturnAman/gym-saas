import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Verified-phone trust rules, pinned against a mocked Clerk client:
 * only numbers Clerk reports as exactly "verified" count; a lookup
 * failure throws (fail closed) instead of returning an empty list that
 * a caller could mistake for "no phone". The submitted-number match
 * itself is a pure canonical-equality check, tested without I/O.
 */

const { mockGetUser } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    users: { getUser: mockGetUser },
  }),
}));

import {
  ClerkPhoneLookupUnavailableError,
  getVerifiedPhoneNumbersForClerkUser,
} from "../clerk-verified-phone";

function clerkUser(
  phones: { phoneNumber: string; status?: string | null }[],
) {
  return {
    phoneNumbers: phones.map((p) => ({
      phoneNumber: p.phoneNumber,
      verification: p.status ? { status: p.status } : null,
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getVerifiedPhoneNumbersForClerkUser", () => {
  it("returns only numbers Clerk reports as verified", async () => {
    mockGetUser.mockResolvedValue(
      clerkUser([
        { phoneNumber: "+919876543210", status: "verified" },
        { phoneNumber: "+919999999999", status: "unverified" },
        { phoneNumber: "+918888888888" },
      ]),
    );
    expect(
      await getVerifiedPhoneNumbersForClerkUser("user_abc"),
    ).toEqual(["+919876543210"]);
  });

  it("returns an empty list (not an error) when nothing is verified", async () => {
    mockGetUser.mockResolvedValue(clerkUser([]));
    expect(await getVerifiedPhoneNumbersForClerkUser("user_abc")).toEqual(
      [],
    );
  });

  it("fails closed on a Clerk API failure: throws, never an empty list", async () => {
    mockGetUser.mockRejectedValue(new Error("network down"));
    await expect(
      getVerifiedPhoneNumbersForClerkUser("user_abc"),
    ).rejects.toBeInstanceOf(ClerkPhoneLookupUnavailableError);
  });
});
