import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUserFindMany, mockFindNames } = vi.hoisted(() => ({
  mockUserFindMany: vi.fn(),
  mockFindNames: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({
  db: { user: { findMany: mockUserFindMany } },
}));

vi.mock("@/lib/server/clerk-directory", () => ({
  findClerkDisplayNamesById: mockFindNames,
}));

import { getStaffDisplayNames } from "./display-names";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getStaffDisplayNames", () => {
  it("bridges local user IDs to Clerk display names", async () => {
    mockUserFindMany.mockResolvedValue([
      { id: "local-1", clerkUserId: "clerk-1" },
      { id: "local-2", clerkUserId: "clerk-2" },
      { id: "local-3", clerkUserId: null },
    ]);
    mockFindNames.mockResolvedValue(
      new Map([
        ["clerk-1", "Asha Rao"],
        ["clerk-2", null],
      ]),
    );
    const labels = await getStaffDisplayNames(["local-1", "local-2", "local-3"]);
    expect(labels.get("local-1")).toBe("Asha Rao");
    expect(labels.get("local-2")).toBeNull();
    // A phone-backed user with no Clerk link gets a null label, and
    // their (absent) Clerk ID is never queried.
    expect(labels.get("local-3")).toBeNull();
    expect(mockFindNames).toHaveBeenCalledWith(["clerk-1", "clerk-2"]);
  });

  it("short-circuits an empty list without touching the database", async () => {
    const labels = await getStaffDisplayNames([]);
    expect(labels.size).toBe(0);
    expect(mockUserFindMany).not.toHaveBeenCalled();
  });
});
