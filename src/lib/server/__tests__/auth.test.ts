import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockUpsert } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockUpsert: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
vi.mock("@/lib/server/db", () => ({ db: { user: { upsert: mockUpsert } } }));

import { getCurrentUser, requireCurrentUser } from "@/lib/server/auth";

const CLERK_USER_ID = "user_2abc123";

const appUser = {
  id: "a8098c1a-f86e-11da-bd1a-00112444be1e",
  clerkUserId: CLERK_USER_ID,
  createdAt: new Date("2026-09-29T00:00:00.000Z"),
  updatedAt: new Date("2026-09-29T00:00:00.000Z"),
};

const expectedUpsert = {
  where: { clerkUserId: CLERK_USER_ID },
  update: {},
  create: { clerkUserId: CLERK_USER_ID },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCurrentUser", () => {
  it("maps an authenticated Clerk identity to the application User", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockUpsert.mockResolvedValue(appUser);

    const user = await getCurrentUser();

    expect(mockAuth).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith(expectedUpsert);
    expect(user).toEqual(appUser);
  });

  it("is safe to call repeatedly: the same identity resolves via upsert, never duplicate creates", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockUpsert.mockResolvedValue(appUser);

    const first = await getCurrentUser();
    const second = await getCurrentUser();

    // Both calls go through upsert on the UNIQUE clerk_user_id — the
    // database constraint guarantees one row per Clerk identity, so
    // repeated synchronization can never create duplicates.
    expect(mockUpsert).toHaveBeenCalledTimes(2);
    expect(mockUpsert).toHaveBeenNthCalledWith(1, expectedUpsert);
    expect(mockUpsert).toHaveBeenNthCalledWith(2, expectedUpsert);
    expect(first).toEqual(second);
  });

  it("returns null without touching the database when unauthenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    expect(await getCurrentUser()).toBeNull();
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe("requireCurrentUser", () => {
  it("returns the application User when authenticated", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockUpsert.mockResolvedValue(appUser);

    await expect(requireCurrentUser()).resolves.toEqual(appUser);
  });

  it("rejects unauthenticated access by redirecting to sign-in", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    // next/navigation's redirect() throws NEXT_REDIRECT; Next.js converts
    // it into a redirect response, so unauthenticated callers never reach
    // the database query or any application data.
    await expect(requireCurrentUser()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
