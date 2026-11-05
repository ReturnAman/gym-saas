import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Member linking, tested against a stateful in-memory fake of the Prisma
 * surface the linking transaction uses. The fake's $transaction snapshots
 * state and restores it on throw (modelling rollback) and serializes
 * transactions through a mutex (modelling serializable execution), so
 * atomicity, replay, and concurrent-link behavior are genuinely exercised
 * rather than asserted from call shapes alone.
 */
const { fakeDb, state, calls, resetFake } = vi.hoisted(() => {
  interface Row {
    [key: string]: unknown;
  }
  interface State {
    users: Row[];
    members: Row[];
    memberships: Row[];
    challenges: Row[];
    sessions: Row[];
    auditLogs: Row[];
  }
  const state: State = {
    users: [],
    members: [],
    memberships: [],
    challenges: [],
    sessions: [],
    auditLogs: [],
  };
  const calls: { method: string; args: unknown }[] = [];
  let seq = 0;
  const nextId = (p: string) => `${p}-${++seq}`;

  function matches(row: Row, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (value === null) return row[key] === null || row[key] === undefined;
      if (
        value !== null &&
        typeof value === "object" &&
        "gt" in (value as Record<string, unknown>)
      ) {
        const gt = (value as { gt: Date }).gt;
        return row[key] instanceof Date && (row[key] as Date) > gt;
      }
      return row[key] === value;
    });
  }

  function p2002(): Error {
    const err = new Error("Unique constraint failed on the fields");
    (err as { code?: string }).code = "P2002";
    err.name = "PrismaClientKnownRequestError";
    return err;
  }

  const tx = {
    memberOtpChallenge: {
      updateMany: async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        calls.push({ method: "challenge.updateMany", args });
        let count = 0;
        for (const row of state.challenges) {
          if (matches(row, args.where)) {
            Object.assign(row, args.data);
            count++;
          }
        }
        return { count };
      },
      findFirst: async (args: { where: Record<string, unknown> }) =>
        state.challenges.find((r) => matches(r, args.where)) ?? null,
    },
    user: {
      upsert: async (args: {
        where: { phoneNumber: string };
        create: Record<string, unknown>;
      }) => {
        calls.push({ method: "user.upsert", args });
        const existing = state.users.find(
          (u) => u.phoneNumber === args.where.phoneNumber,
        );
        if (existing) return existing;
        const user = {
          id: nextId("user"),
          clerkUserId: null,
          ...args.create,
        };
        state.users.push(user);
        return user;
      },
    },
    member: {
      findMany: async (args: { where: Record<string, unknown> }) =>
        state.members.filter((r) => matches(r, args.where)),
      findFirst: async (args: { where: Record<string, unknown> }) =>
        state.members.find((r) => matches(r, args.where)) ?? null,
      update: async (args: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        calls.push({ method: "member.update", args });
        const row = state.members.find((m) => m.id === args.where.id);
        if (!row) throw new Error("member not found");
        if (args.data.userId) {
          const clash = state.members.some(
            (m) =>
              m.id !== row.id &&
              m.organizationId === row.organizationId &&
              m.userId === args.data.userId,
          );
          if (clash) throw p2002();
        }
        Object.assign(row, args.data);
        return row;
      },
    },
    organizationMembership: {
      findUnique: async (args: {
        where: {
          userId_organizationId: { userId: string; organizationId: string };
        };
      }) =>
        state.memberships.find(
          (m) =>
            m.userId === args.where.userId_organizationId.userId &&
            m.organizationId ===
              args.where.userId_organizationId.organizationId,
        ) ?? null,
      create: async (args: { data: Record<string, unknown> }) => {
        const row = { id: nextId("membership"), ...args.data };
        state.memberships.push(row);
        return row;
      },
    },
    memberSession: {
      create: async (args: { data: Record<string, unknown> }) => {
        calls.push({ method: "session.create", args });
        const row = { id: nextId("session"), ...args.data };
        state.sessions.push(row);
        return row;
      },
    },
    auditLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        calls.push({ method: "audit.create", args });
        const row = { id: nextId("audit"), ...args.data };
        state.auditLogs.push(row);
        return row;
      },
    },
  };

  let chain: Promise<unknown> = Promise.resolve();
  const fakeDb = {
    $transaction: (cb: (t: typeof tx) => Promise<unknown>) => {
      const run = chain.then(async () => {
        const snapshot = structuredClone(state);
        try {
          return await cb(tx);
        } catch (error) {
          state.users = snapshot.users;
          state.members = snapshot.members;
          state.memberships = snapshot.memberships;
          state.challenges = snapshot.challenges;
          state.sessions = snapshot.sessions;
          state.auditLogs = snapshot.auditLogs;
          throw error;
        }
      });
      chain = run.catch(() => undefined);
      return run;
    },
  };

  function resetFake() {
    state.users = [];
    state.members = [];
    state.memberships = [];
    state.challenges = [];
    state.sessions = [];
    state.auditLogs = [];
    calls.length = 0;
    seq = 0;
    chain = Promise.resolve();
  }

  return { fakeDb, state, calls, resetFake };
});

vi.mock("@/lib/server/db", () => ({ db: fakeDb }));

import {
  MemberLinkingError,
  linkVerifiedChallenge,
} from "@/lib/server/member-linking";

const ORG_A = "org-a";
const ORG_B = "org-b";
const PHONE = "9876543210";

function seedChallenge(overrides: Record<string, unknown> = {}) {
  const challenge = {
    id: "challenge-1",
    organizationId: ORG_A,
    phoneNumber: PHONE,
    otpHash: "0".repeat(64),
    status: "VERIFIED",
    attempts: 0,
    expiresAt: new Date(Date.now() + 5 * 60_000),
    verifiedAt: new Date(),
    consumedAt: null,
    ...overrides,
  };
  state.challenges.push(challenge);
  return challenge;
}

function seedMember(overrides: Record<string, unknown> = {}) {
  const member = {
    id: `member-${state.members.length + 1}`,
    organizationId: ORG_A,
    userId: null,
    name: "Test Member",
    phoneNumber: PHONE,
    ...overrides,
  };
  state.members.push(member);
  return member;
}

beforeEach(() => {
  resetFake();
});

describe("linkVerifiedChallenge — happy path", () => {
  it("claims, links, creates the phone-backed user, membership, session, and audit event", async () => {
    seedChallenge();
    const member = seedMember();

    const result = await linkVerifiedChallenge({
      organizationId: ORG_A,
      challengeId: "challenge-1",
    });

    expect(result.organizationId).toBe(ORG_A);
    expect(result.memberId).toBe(member.id);

    // Phone-backed user: created by phone, no Clerk identity.
    expect(state.users).toHaveLength(1);
    expect(state.users[0]?.phoneNumber).toBe(PHONE);
    expect(state.users[0]?.clerkUserId).toBeNull();
    expect(result.userId).toBe(state.users[0]?.id);

    // Member linked; membership ensured as MEMBER.
    expect(state.members[0]?.userId).toBe(result.userId);
    expect(state.memberships).toHaveLength(1);
    expect(state.memberships[0]).toMatchObject({
      userId: result.userId,
      organizationId: ORG_A,
      role: "MEMBER",
    });

    // Session: gym-scoped, hash-only storage of the returned raw token.
    expect(state.sessions).toHaveLength(1);
    const session = state.sessions[0]!;
    expect(session.organizationId).toBe(ORG_A);
    expect(session.userId).toBe(result.userId);
    expect(session.tokenHash).toBe(
      createHash("sha256").update(result.rawToken).digest("hex"),
    );
    expect(session.tokenHash).not.toBe(result.rawToken);
    expect(JSON.stringify(session)).not.toContain(result.rawToken);

    // Audit + claim.
    expect(state.auditLogs).toHaveLength(1);
    expect(state.auditLogs[0]).toMatchObject({
      event: "MEMBER_LINKED",
      organizationId: ORG_A,
      actorUserId: result.userId,
      targetType: "Member",
      targetId: member.id,
    });
    expect(state.challenges[0]?.consumedAt).toBeInstanceOf(Date);

    // The claim itself is the guarded atomic update.
    const claim = calls.find((c) => c.method === "challenge.updateMany");
    const where = (claim?.args as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({
      id: "challenge-1",
      organizationId: ORG_A,
      status: "VERIFIED",
      consumedAt: null,
    });
    expect(where.verifiedAt).toHaveProperty("gt");
  });

  it("reuses the same phone-backed User across gyms, with separate memberships and sessions", async () => {
    seedChallenge();
    seedMember();
    const first = await linkVerifiedChallenge({
      organizationId: ORG_A,
      challengeId: "challenge-1",
    });

    seedChallenge({ id: "challenge-2", organizationId: ORG_B });
    seedMember({ id: "member-b", organizationId: ORG_B });
    const second = await linkVerifiedChallenge({
      organizationId: ORG_B,
      challengeId: "challenge-2",
    });

    expect(second.userId).toBe(first.userId);
    expect(state.users).toHaveLength(1);
    expect(state.memberships).toHaveLength(2);
    expect(state.sessions).toHaveLength(2);
    expect(state.sessions[1]?.organizationId).toBe(ORG_B);
  });

  it("is idempotent for the same user via a fresh verified challenge", async () => {
    seedChallenge();
    seedMember();
    const first = await linkVerifiedChallenge({
      organizationId: ORG_A,
      challengeId: "challenge-1",
    });
    seedChallenge({ id: "challenge-2" });
    const second = await linkVerifiedChallenge({
      organizationId: ORG_A,
      challengeId: "challenge-2",
    });
    expect(second.userId).toBe(first.userId);
    expect(second.memberId).toBe(first.memberId);
    expect(state.memberships).toHaveLength(1);
  });

  it("never modifies an existing membership role", async () => {
    // The phone-backed user already holds an OWNER membership in this gym.
    state.users.push({ id: "user-x", clerkUserId: null, phoneNumber: PHONE });
    state.memberships.push({
      id: "membership-x",
      userId: "user-x",
      organizationId: ORG_A,
      role: "OWNER",
    });
    seedChallenge();
    seedMember();
    const result = await linkVerifiedChallenge({
      organizationId: ORG_A,
      challengeId: "challenge-1",
    });
    expect(result.userId).toBe("user-x");
    expect(state.memberships).toHaveLength(1);
    expect(state.memberships[0]?.role).toBe("OWNER");
  });
});

describe("linkVerifiedChallenge — challenge guards", () => {
  it("rejects replay of an already-consumed challenge", async () => {
    seedChallenge();
    seedMember();
    await linkVerifiedChallenge({
      organizationId: ORG_A,
      challengeId: "challenge-1",
    });
    await expect(
      linkVerifiedChallenge({
        organizationId: ORG_A,
        challengeId: "challenge-1",
      }),
    ).rejects.toBeInstanceOf(MemberLinkingError);
    expect(state.sessions).toHaveLength(1);
  });

  it("allows exactly one winner under concurrent linking of the same challenge", async () => {
    seedChallenge();
    seedMember();
    const results = await Promise.allSettled([
      linkVerifiedChallenge({ organizationId: ORG_A, challengeId: "challenge-1" }),
      linkVerifiedChallenge({ organizationId: ORG_A, challengeId: "challenge-1" }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      MemberLinkingError,
    );
    expect(state.sessions).toHaveLength(1);
    expect(state.users).toHaveLength(1);
  });

  it("rejects a challenge verified outside the 5-minute linking window", async () => {
    seedChallenge({ verifiedAt: new Date(Date.now() - 6 * 60_000) });
    seedMember();
    await expect(
      linkVerifiedChallenge({ organizationId: ORG_A, challengeId: "challenge-1" }),
    ).rejects.toBeInstanceOf(MemberLinkingError);
    expect(state.users).toHaveLength(0);
    expect(state.sessions).toHaveLength(0);
    expect(state.challenges[0]?.consumedAt).toBeNull();
  });

  it("rejects a non-VERIFIED challenge and a challenge from another gym", async () => {
    seedChallenge({ id: "c-pending", status: "PENDING", verifiedAt: null });
    seedChallenge({ id: "c-other-gym", organizationId: ORG_B });
    seedMember();
    await expect(
      linkVerifiedChallenge({ organizationId: ORG_A, challengeId: "c-pending" }),
    ).rejects.toBeInstanceOf(MemberLinkingError);
    await expect(
      linkVerifiedChallenge({
        organizationId: ORG_A,
        challengeId: "c-other-gym",
      }),
    ).rejects.toBeInstanceOf(MemberLinkingError);
    expect(state.sessions).toHaveLength(0);
  });
});

describe("linkVerifiedChallenge — linking rules and atomicity", () => {
  it("fails on multiple unlinked candidates and rolls EVERYTHING back", async () => {
    seedChallenge();
    seedMember({ id: "member-1" });
    seedMember({ id: "member-2" });
    await expect(
      linkVerifiedChallenge({ organizationId: ORG_A, challengeId: "challenge-1" }),
    ).rejects.toBeInstanceOf(MemberLinkingError);
    // Rollback: claim undone, no user, no link, no session, no audit.
    expect(state.challenges[0]?.consumedAt).toBeNull();
    expect(state.users).toHaveLength(0);
    expect(state.members.every((m) => m.userId === null)).toBe(true);
    expect(state.sessions).toHaveLength(0);
    expect(state.auditLogs).toHaveLength(0);
  });

  it("never overwrites a Member linked to another user", async () => {
    seedChallenge();
    seedMember({ userId: "someone-else" });
    await expect(
      linkVerifiedChallenge({ organizationId: ORG_A, challengeId: "challenge-1" }),
    ).rejects.toBeInstanceOf(MemberLinkingError);
    expect(state.members[0]?.userId).toBe("someone-else");
    expect(state.sessions).toHaveLength(0);
  });

  it("fails when the user is already linked to a different Member in the same gym", async () => {
    state.users.push({ id: "user-x", clerkUserId: null, phoneNumber: PHONE });
    // user-x is linked to a member whose recorded phone differs (staff edit).
    seedMember({ id: "member-old", userId: "user-x", phoneNumber: "9000000001" });
    seedChallenge();
    seedMember({ id: "member-new" });
    await expect(
      linkVerifiedChallenge({ organizationId: ORG_A, challengeId: "challenge-1" }),
    ).rejects.toBeInstanceOf(MemberLinkingError);
    expect(state.members.find((m) => m.id === "member-new")?.userId).toBeNull();
    expect(state.sessions).toHaveLength(0);
  });
});
