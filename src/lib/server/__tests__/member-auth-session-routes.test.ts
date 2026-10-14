import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockLinkMember,
  mockIsSameOrigin,
  mockSetCookie,
  mockClearCookie,
  mockReadToken,
  mockRevoke,
  MockLinkingError,
} = vi.hoisted(() => {
  class MockLinkingError extends Error {
    constructor() {
      super("Linking failed.");
      this.name = "MemberLinkingError";
    }
  }
  return {
    mockLinkMember: vi.fn(),
    mockIsSameOrigin: vi.fn(),
    mockSetCookie: vi.fn(),
    mockClearCookie: vi.fn(),
    mockReadToken: vi.fn(),
    mockRevoke: vi.fn(),
    MockLinkingError,
  };
});

vi.mock("@/lib/server/member-auth", () => ({ linkMember: mockLinkMember }));
vi.mock("@/lib/server/member-linking", () => ({
  MemberLinkingError: MockLinkingError,
}));
vi.mock("@/lib/server/member-session", () => ({
  isSameOriginRequest: mockIsSameOrigin,
  setMemberSessionCookie: mockSetCookie,
  clearMemberSessionCookie: mockClearCookie,
  readMemberSessionToken: mockReadToken,
  revokeMemberSession: mockRevoke,
}));

import { POST as linkPOST } from "@/app/api/member-auth/link/route";
import { POST as logoutPOST } from "@/app/api/member-auth/logout/route";

const RAW_TOKEN = "raw-token-fixture";

function jsonRequest(body: unknown) {
  return new Request("https://gym.example.com/api/member-auth/link", {
    method: "POST",
    headers: { "content-type": "application/json", host: "gym.example.com" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsSameOrigin.mockReturnValue(true);
});

describe("POST /api/member-auth/link", () => {
  it("sets the session cookie after a successful link and leaks no token in the body", async () => {
    mockLinkMember.mockResolvedValue({
      rawToken: RAW_TOKEN,
      userId: "user-1",
      memberId: "member-1",
      organizationId: "org-a",
    });
    const response = await linkPOST(
      jsonRequest({ organizationId: "org-a", challengeId: "challenge-1" }),
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ linked: true });
    expect(body).not.toContain(RAW_TOKEN);
    expect(mockSetCookie).toHaveBeenCalledWith(RAW_TOKEN);
  });

  it("returns the generic failure for a linking error and sets no cookie", async () => {
    mockLinkMember.mockRejectedValue(new MockLinkingError());
    const response = await linkPOST(
      jsonRequest({ organizationId: "org-a", challengeId: "challenge-1" }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "LINK_FAILED",
        message:
          "We could not complete sign-in. Please request a new code and try again, or ask the gym for help.",
      },
    });
    expect(mockSetCookie).not.toHaveBeenCalled();
  });

  it("rejects malformed bodies and cross-origin requests generically", async () => {
    const bad = await linkPOST(jsonRequest({ organizationId: "org-a" }));
    expect(bad.status).toBe(400);
    mockIsSameOrigin.mockReturnValue(false);
    const cross = await linkPOST(
      jsonRequest({ organizationId: "org-a", challengeId: "c" }),
    );
    expect(cross.status).toBe(400);
    expect(mockLinkMember).not.toHaveBeenCalled();
  });
});

describe("POST /api/member-auth/logout", () => {
  it("revokes the session server-side and clears the cookie", async () => {
    mockReadToken.mockResolvedValue(RAW_TOKEN);
    const response = await logoutPOST(
      new Request("https://gym.example.com/api/member-auth/logout", {
        method: "POST",
        headers: { host: "gym.example.com" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ loggedOut: true });
    expect(mockRevoke).toHaveBeenCalledWith(RAW_TOKEN);
    expect(mockClearCookie).toHaveBeenCalled();
  });

  it("rejects cross-origin requests without revoking", async () => {
    mockIsSameOrigin.mockReturnValue(false);
    const response = await logoutPOST(
      new Request("https://gym.example.com/api/member-auth/logout", {
        method: "POST",
        headers: { host: "gym.example.com" },
      }),
    );
    expect(response.status).toBe(403);
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it("on a database failure: clears the cookie but does not claim revocation (H2)", async () => {
    const { Prisma } = await import("@prisma/client");
    mockReadToken.mockResolvedValue(RAW_TOKEN);
    mockRevoke.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Can't reach database server", {
        code: "P1001",
        clientVersion: "7.10.0",
      }),
    );
    const response = await logoutPOST(
      new Request("https://gym.example.com/api/member-auth/logout", {
        method: "POST",
        headers: { host: "gym.example.com" },
      }),
    );
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe("DATABASE_UNAVAILABLE");
    expect(body.loggedOut).toBeUndefined();
    expect(mockClearCookie).toHaveBeenCalled();
  });
});
