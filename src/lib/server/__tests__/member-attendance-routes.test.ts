import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetMemberContext, mockCheckInSelf } = vi.hoisted(() => ({
  mockGetMemberContext: vi.fn(),
  mockCheckInSelf: vi.fn(),
}));

// The real member-session module is loaded (the origin guard under test
// is the production one) with only the cookie-reading context resolver
// replaced. The db and Clerk-touching auth modules are stubbed so
// loading the real attendance module for its error classes stays inert.
vi.mock("@/lib/server/db", () => ({
  db: { organization: { findUnique: vi.fn().mockResolvedValue(null) } },
}));
vi.mock("@/lib/server/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/server/member-session", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/server/member-session")>();
  return { ...original, getMemberContext: mockGetMemberContext };
});
vi.mock("@/lib/server/attendance", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/server/attendance")>();
  return { ...original, checkInSelf: mockCheckInSelf };
});

import { POST } from "@/app/api/member-attendance/check-in/route";
import {
  AttendanceAlreadyCheckedInError,
  AttendanceMembershipExpiredError,
  AttendanceNoMembershipError,
  AttendanceNotFoundError,
} from "@/lib/server/attendance";
import type { MemberSessionContext } from "@/lib/server/member-session";

const ORG_ID = "org-a";

function contextFixture(): MemberSessionContext {
  return {
    session: { id: "session-1", organizationId: ORG_ID },
    user: { id: "user-1" },
    organization: { id: ORG_ID, name: "Gym A" },
    membership: { organizationId: ORG_ID, role: "MEMBER" },
    member: { id: "member-1", name: "Test Member" },
  } as unknown as MemberSessionContext;
}

function checkInRequest(
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Request("https://gym.example.com/api/member-attendance/check-in", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "gym.example.com",
      origin: "https://gym.example.com",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetMemberContext.mockResolvedValue(contextFixture());
  mockCheckInSelf.mockResolvedValue({ sessionId: "attendance-1" });
});

describe("POST /api/member-attendance/check-in", () => {
  it("rejects cross-origin requests before resolving any session", async () => {
    const response = await POST(
      checkInRequest({ gym: ORG_ID }, { origin: "https://evil.example.com" }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "FORBIDDEN",
        message: "Request origin could not be verified.",
      },
    });
    expect(mockGetMemberContext).not.toHaveBeenCalled();
    expect(mockCheckInSelf).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests without calling the service", async () => {
    mockGetMemberContext.mockResolvedValue(null);
    const response = await POST(checkInRequest({ gym: ORG_ID }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Sign in required." },
    });
    expect(mockCheckInSelf).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON and missing/invalid gym claims generically", async () => {
    const badJson = await POST(checkInRequest("{not json"));
    expect(badJson.status).toBe(400);

    for (const body of [{}, { gym: "" }, { gym: "   " }, { gym: 42 }]) {
      const response = await POST(checkInRequest(body));
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("CHECK_IN_FAILED");
    }
    expect(mockCheckInSelf).not.toHaveBeenCalled();
  });

  it("rejects a QR gym that does not match the session gym — service never invoked", async () => {
    const response = await POST(checkInRequest({ gym: "org-b" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "GYM_MISMATCH",
        message: "This check-in code is for a different gym.",
      },
    });
    expect(mockCheckInSelf).not.toHaveBeenCalled();
  });

  it("checks in via the session context when the gym matches", async () => {
    const context = contextFixture();
    mockGetMemberContext.mockResolvedValue(context);
    const response = await POST(checkInRequest({ gym: ORG_ID }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: "checked_in" });
    expect(mockCheckInSelf).toHaveBeenCalledTimes(1);
    // The context is the ONLY argument — identity comes from the session.
    expect(mockCheckInSelf.mock.calls[0]).toEqual([context]);
  });

  it("ignores stray memberId/phone fields in the body entirely", async () => {
    const context = contextFixture();
    mockGetMemberContext.mockResolvedValue(context);
    const response = await POST(
      checkInRequest({
        gym: ORG_ID,
        memberId: "someone-else",
        phoneNumber: "9999999999",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: "checked_in" });
    expect(mockCheckInSelf.mock.calls[0]).toEqual([context]);
  });

  it("maps an existing open session to already_checked_in (not an error)", async () => {
    mockCheckInSelf.mockRejectedValue(new AttendanceAlreadyCheckedInError());
    const response = await POST(checkInRequest({ gym: ORG_ID }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: "already_checked_in" });
  });

  it("blocks an expired membership with the front-desk message", async () => {
    mockCheckInSelf.mockRejectedValue(new AttendanceMembershipExpiredError());
    const response = await POST(checkInRequest({ gym: ORG_ID }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("MEMBERSHIP_EXPIRED");
    expect(body.error.message).toContain("Please see the front desk.");
  });

  it("maps no-membership and missing-member failures to the generic front-desk error", async () => {
    mockCheckInSelf.mockRejectedValue(new AttendanceNoMembershipError());
    const noMembership = await POST(checkInRequest({ gym: ORG_ID }));
    expect(noMembership.status).toBe(400);
    expect(await noMembership.json()).toEqual({
      error: {
        code: "CHECK_IN_FAILED",
        message: "Could not check in. Please see the front desk.",
      },
    });

    mockCheckInSelf.mockRejectedValue(new AttendanceNotFoundError());
    const notFound = await POST(checkInRequest({ gym: ORG_ID }));
    expect(notFound.status).toBe(400);
    expect((await notFound.json()).error.code).toBe("CHECK_IN_FAILED");
  });

  it("returns a generic 500 for unexpected service errors", async () => {
    mockCheckInSelf.mockRejectedValue(new Error("db exploded: internals"));
    const response = await POST(checkInRequest({ gym: ORG_ID }));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("internals");
  });
});
