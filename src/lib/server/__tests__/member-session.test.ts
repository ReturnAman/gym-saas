import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSessionFindUnique,
  mockSessionUpdate,
  mockSessionUpdateMany,
  mockUserFindUnique,
  mockMembershipFindUnique,
  mockMemberFindFirst,
  cookieStore,
} = vi.hoisted(() => ({
  mockSessionFindUnique: vi.fn(),
  mockSessionUpdate: vi.fn(),
  mockSessionUpdateMany: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockMembershipFindUnique: vi.fn(),
  mockMemberFindFirst: vi.fn(),
  cookieStore: {
    values: new Map<string, string>(),
    setCalls: [] as { name: string; value: string; options: unknown }[],
    get(name: string) {
      const v = this.values.get(name);
      return v === undefined ? undefined : { name, value: v };
    },
    set(name: string, value: string, options: unknown) {
      this.setCalls.push({ name, value, options });
      this.values.set(name, value);
    },
  },
}));

vi.mock("@/lib/server/db", () => ({
  db: {
    memberSession: {
      findUnique: mockSessionFindUnique,
      update: mockSessionUpdate,
      updateMany: mockSessionUpdateMany,
    },
    user: { findUnique: mockUserFindUnique },
    organizationMembership: { findUnique: mockMembershipFindUnique },
    member: { findFirst: mockMemberFindFirst },
  },
}));

vi.mock("next/headers", () => ({
  cookies: async () => cookieStore,
}));

import {
  MEMBER_SESSION_ABSOLUTE_TTL_MS,
  MEMBER_SESSION_COOKIE_MAX_AGE_SECONDS,
  MEMBER_SESSION_COOKIE_NAME,
  clearMemberSessionCookie,
  createMemberSession,
  generateMemberSessionToken,
  getMemberContext,
  hashMemberSessionToken,
  isSameOriginRequest,
  readMemberSessionToken,
  resolveMemberSession,
  revokeMemberSession,
  setMemberSessionCookie,
} from "@/lib/server/member-session";

const ORG_A = "org-a";
const USER_ID = "user-1";
const RAW_TOKEN = "raw-token-fixture";

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    userId: USER_ID,
    organizationId: ORG_A,
    tokenHash: hashMemberSessionToken(RAW_TOKEN),
    expiresAt: new Date(Date.now() + MEMBER_SESSION_ABSOLUTE_TTL_MS),
    lastSeenAt: new Date(),
    revokedAt: null,
    ...overrides,
  };
}

function mockValidResolution() {
  mockUserFindUnique.mockResolvedValue({ id: USER_ID, phoneNumber: "9876543210" });
  mockMembershipFindUnique.mockResolvedValue({
    userId: USER_ID,
    organizationId: ORG_A,
    role: "MEMBER",
    organization: { id: ORG_A, name: "Gym A" },
  });
  mockMemberFindFirst.mockResolvedValue({
    id: "member-1",
    organizationId: ORG_A,
    userId: USER_ID,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.values.clear();
  cookieStore.setCalls.length = 0;
  mockSessionUpdate.mockResolvedValue({});
  mockSessionUpdateMany.mockResolvedValue({ count: 1 });
});

describe("tokens", () => {
  it("generates 32-byte base64url tokens, unique per call", () => {
    const a = generateMemberSessionToken();
    const b = generateMemberSessionToken();
    expect(a).not.toBe(b);
    // base64url of 32 bytes = 43 characters, url-safe alphabet only.
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("hashes with SHA-256 (hex) and never stores the raw token", () => {
    const hash = hashMemberSessionToken(RAW_TOKEN);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(RAW_TOKEN);
    expect(hashMemberSessionToken(RAW_TOKEN)).toBe(hash);
  });
});

describe("createMemberSession", () => {
  it("persists only the hash, scoped to user + organization, 30-day expiry", async () => {
    const create = vi.fn(async (args: { data: Record<string, unknown> }) => ({
      id: "session-1",
      ...args.data,
    }));
    const before = Date.now();
    const { rawToken, session } = await createMemberSession(
      { memberSession: { create } } as never,
      { userId: USER_ID, organizationId: ORG_A },
    );
    const data = create.mock.calls[0]![0].data;
    expect(data.tokenHash).toBe(hashMemberSessionToken(rawToken));
    expect(JSON.stringify(data)).not.toContain(rawToken);
    expect(data.userId).toBe(USER_ID);
    expect(data.organizationId).toBe(ORG_A);
    const expiresAt = (data.expiresAt as Date).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + MEMBER_SESSION_ABSOLUTE_TTL_MS - 1000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + MEMBER_SESSION_ABSOLUTE_TTL_MS + 1000);
    expect(session.id).toBe("session-1");
  });
});

describe("resolveMemberSession", () => {
  it("resolves a valid session to its gym-bound context", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    mockValidResolution();
    const context = await resolveMemberSession(RAW_TOKEN);
    expect(context).not.toBeNull();
    expect(context?.organization.id).toBe(ORG_A);
    expect(context?.membership.role).toBe("MEMBER");
    expect(context?.member?.id).toBe("member-1");
    // Lookups were bound to the SESSION's user + organization (cross-gym safe).
    expect(mockSessionFindUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashMemberSessionToken(RAW_TOKEN) },
    });
    expect(mockMembershipFindUnique).toHaveBeenCalledWith({
      where: {
        userId_organizationId: { userId: USER_ID, organizationId: ORG_A },
      },
      include: { organization: true },
    });
  });

  it("returns null for unknown, revoked, or missing tokens", async () => {
    expect(await resolveMemberSession(null)).toBeNull();
    expect(mockSessionFindUnique).not.toHaveBeenCalled();

    mockSessionFindUnique.mockResolvedValue(null);
    expect(await resolveMemberSession("nope")).toBeNull();

    mockSessionFindUnique.mockResolvedValue(
      sessionRow({ revokedAt: new Date() }),
    );
    expect(await resolveMemberSession(RAW_TOKEN)).toBeNull();
  });

  it("rejects an absolutely-expired session and marks it revoked", async () => {
    mockSessionFindUnique.mockResolvedValue(
      sessionRow({ expiresAt: new Date(Date.now() - 1000) }),
    );
    expect(await resolveMemberSession(RAW_TOKEN)).toBeNull();
    expect(mockSessionUpdate).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("rejects an idle-expired session (7 days) and marks it revoked", async () => {
    mockSessionFindUnique.mockResolvedValue(
      sessionRow({
        lastSeenAt: new Date(Date.now() - 7 * 24 * 60 * 60_000 - 1000),
      }),
    );
    expect(await resolveMemberSession(RAW_TOKEN)).toBeNull();
    expect(mockSessionUpdate).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("touches lastSeenAt only when it is more than an hour stale", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    mockValidResolution();
    await resolveMemberSession(RAW_TOKEN);
    expect(mockSessionUpdate).not.toHaveBeenCalled();

    mockSessionFindUnique.mockResolvedValue(
      sessionRow({ lastSeenAt: new Date(Date.now() - 2 * 60 * 60_000) }),
    );
    await resolveMemberSession(RAW_TOKEN);
    expect(mockSessionUpdate).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: { lastSeenAt: expect.any(Date) },
    });
  });

  it("fails closed when the membership for the session's gym is gone", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    mockUserFindUnique.mockResolvedValue({ id: USER_ID });
    mockMembershipFindUnique.mockResolvedValue(null);
    mockMemberFindFirst.mockResolvedValue(null);
    expect(await resolveMemberSession(RAW_TOKEN)).toBeNull();
  });
});

describe("revokeMemberSession", () => {
  it("revokes by token hash, only if not already revoked", async () => {
    await revokeMemberSession(RAW_TOKEN);
    expect(mockSessionUpdateMany).toHaveBeenCalledWith({
      where: { tokenHash: hashMemberSessionToken(RAW_TOKEN), revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    await revokeMemberSession(null);
    expect(mockSessionUpdateMany).toHaveBeenCalledTimes(1);
  });
});

describe("cookie helpers", () => {
  it("sets the cookie with exactly the approved flags", async () => {
    await setMemberSessionCookie(RAW_TOKEN);
    expect(cookieStore.setCalls).toHaveLength(1);
    const call = cookieStore.setCalls[0]!;
    expect(call.name).toBe(MEMBER_SESSION_COOKIE_NAME);
    expect(call.value).toBe(RAW_TOKEN);
    expect(call.options).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: MEMBER_SESSION_COOKIE_MAX_AGE_SECONDS,
    });
    expect(MEMBER_SESSION_COOKIE_MAX_AGE_SECONDS).toBe(30 * 24 * 60 * 60);
    expect(await readMemberSessionToken()).toBe(RAW_TOKEN);
  });

  it("clears the cookie with the same flags and Max-Age 0", async () => {
    await clearMemberSessionCookie();
    const call = cookieStore.setCalls[0]!;
    expect(call.options).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  });

  it("getMemberContext resolves through the cookie", async () => {
    cookieStore.values.set(MEMBER_SESSION_COOKIE_NAME, RAW_TOKEN);
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    mockValidResolution();
    const context = await getMemberContext();
    expect(context?.organization.id).toBe(ORG_A);
  });
});

describe("isSameOriginRequest", () => {
  function req(origin?: string) {
    return new Request("https://gym.example.com/api/member-auth/logout", {
      method: "POST",
      headers: {
        host: "gym.example.com",
        ...(origin ? { origin } : {}),
      },
    });
  }
  it("accepts same-origin and origin-less requests", () => {
    expect(isSameOriginRequest(req("https://gym.example.com"))).toBe(true);
    expect(isSameOriginRequest(req())).toBe(true);
  });
  it("rejects cross-origin and malformed origins", () => {
    expect(isSameOriginRequest(req("https://evil.example.com"))).toBe(false);
    expect(isSameOriginRequest(req("not a url"))).toBe(false);
  });
});
