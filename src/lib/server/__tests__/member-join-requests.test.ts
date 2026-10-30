import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * Member join requests, tested against a stateful in-memory fake of
 * the Prisma surface the service uses. The fake's $transaction
 * snapshots state and restores it on throw (modelling rollback) and
 * serializes transactions through a mutex, so atomicity and the
 * outcome-rollback contract are genuinely exercised. The fake's
 * join-request create enforces the one-pending-per-(org, phone) rule
 * the migration's partial unique index enforces on a real database;
 * true READ COMMITTED interleavings live in the database suite.
 */
const { fakeDb, state, flags, resetFake } = vi.hoisted(() => {
  interface Row {
    [key: string]: unknown;
  }
  interface State {
    users: Row[];
    members: Row[];
    memberships: Row[];
    challenges: Row[];
    joinRequests: Row[];
    auditLogs: Row[];
    orgMemberships: Row[];
  }
  const state: State = {
    users: [],
    members: [],
    memberships: [],
    challenges: [],
    joinRequests: [],
    auditLogs: [],
    orgMemberships: [],
  };
  const flags = { failAudit: false, transactionCalls: 0 };
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

  function pendingViolation(): Error {
    return new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`organization_id`, `phone_number`)",
      {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["member_join_requests_one_pending_per_phone"] },
      },
    );
  }

  const joinRequestOps = {
    findFirst: async (args: { where: Record<string, unknown> }) =>
      state.joinRequests.find((r) => matches(r, args.where)) ?? null,
    findMany: async (args: {
      where: Record<string, unknown>;
      orderBy?: { createdAt?: string };
      take?: number;
    }) => {
      let rows = state.joinRequests.filter((r) => matches(r, args.where));
      if (args.orderBy?.createdAt === "asc") {
        rows = [...rows].sort(
          (a, b) =>
            (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime(),
        );
      }
      return args.take ? rows.slice(0, args.take) : rows;
    },
    count: async (args: { where: Record<string, unknown> }) =>
      state.joinRequests.filter((r) => matches(r, args.where)).length,
    create: async (args: { data: Record<string, unknown> }) => {
      const clash = state.joinRequests.some(
        (r) =>
          r.organizationId === args.data.organizationId &&
          r.phoneNumber === args.data.phoneNumber &&
          r.status === "PENDING",
      );
      if (clash) throw pendingViolation();
      const row = {
        id: nextId("request"),
        createdAt: new Date(),
        updatedAt: new Date(),
        decidedByUserId: null,
        decidedAt: null,
        resultingMemberId: null,
        ...args.data,
        // The fake stores the fee as its string form; the real
        // Decimal behaviour is asserted in the database suite.
        proposedFee: String(args.data.proposedFee),
      };
      state.joinRequests.push(row);
      return row;
    },
    updateMany: async (args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      let count = 0;
      for (const row of state.joinRequests) {
        if (matches(row, args.where)) {
          Object.assign(row, args.data);
          count++;
        }
      }
      return { count };
    },
    update: async (args: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const row = state.joinRequests.find((r) => r.id === args.where.id);
      if (!row) throw new Error("join request row missing in fake");
      Object.assign(row, args.data);
      return row;
    },
  };

  const tx = {
    // The per-phone advisory lock is a no-op in the fake: its
    // serialized transactions already linearize submissions.
    $executeRaw: async () => 1,
    // The decider revalidation's locked raw read: the fake ignores
    // the SQL text and answers from the interpolated (userId,
    // organizationId) values against orgMemberships state.
    $queryRaw: async (
      _strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      const [userId, organizationId] = values;
      return state.orgMemberships
        .filter(
          (m) => m.userId === userId && m.organizationId === organizationId,
        )
        .map((m) => ({ role: m.role }));
    },
    memberOtpChallenge: {
      updateMany: async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
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
        update: Record<string, unknown>;
        create: Record<string, unknown>;
      }) => {
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
      create: async (args: { data: Record<string, unknown> }) => {
        const row = { id: nextId("member"), ...args.data };
        state.members.push(row);
        return row;
      },
      update: async (args: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = state.members.find((r) => r.id === args.where.id);
        if (!row) throw new Error("member row missing in fake");
        Object.assign(row, args.data);
        return row;
      },
    },
    membership: {
      count: async (args: { where: Record<string, unknown> }) =>
        state.memberships.filter((r) => matches(r, args.where)).length,
      create: async (args: { data: Record<string, unknown> }) => {
        const row = {
          id: nextId("membership"),
          ...args.data,
          // String form, like the join-request fee: a real Decimal in
          // state would defeat the transaction snapshot.
          fee: String(args.data.fee),
        };
        state.memberships.push(row);
        return row;
      },
    },
    memberJoinRequest: joinRequestOps,
    auditLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        if (flags.failAudit) throw new Error("audit write failed");
        const row = { id: nextId("audit"), ...args.data };
        state.auditLogs.push(row);
        return row;
      },
    },
    // SaaS trial fixture: the entitlement guard reads a live trial for
    // the gym under test, mirroring what onboarding creates.
    organizationSubscription: {
      findUnique: async () => ({
        suspendedAt: null,
        paidThroughAt: null,
        trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
      }),
    },
  };

  let chain: Promise<unknown> = Promise.resolve();
  const fakeDb = {
    $transaction: (cb: (t: typeof tx) => Promise<unknown>) => {
      flags.transactionCalls += 1;
      const run = chain.then(async () => {
        const snapshot = structuredClone(state);
        try {
          return await cb(tx);
        } catch (error) {
          state.users = snapshot.users;
          state.members = snapshot.members;
          state.memberships = snapshot.memberships;
          state.challenges = snapshot.challenges;
          state.joinRequests = snapshot.joinRequests;
          state.auditLogs = snapshot.auditLogs;
          state.orgMemberships = snapshot.orgMemberships;
          throw error;
        }
      });
      chain = run.catch(() => undefined);
      return run;
    },
    memberJoinRequest: joinRequestOps,
    organizationMembership: {
      findFirst: async (args: { where: { userId: string } }) => {
        const row = state.orgMemberships.find(
          (m) => m.userId === args.where.userId,
        );
        return row ? { ...row, organization: { id: row.organizationId } } : null;
      },
    },
    // Same live-trial fixture for the in-transaction guard.
    organizationSubscription: {
      findUnique: async () => ({
        suspendedAt: null,
        paidThroughAt: null,
        trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
      }),
    },
  };

  function resetFake() {
    state.users = [];
    state.members = [];
    state.memberships = [];
    state.challenges = [];
    state.joinRequests = [];
    state.auditLogs = [];
    state.orgMemberships = [];
    flags.failAudit = false;
    flags.transactionCalls = 0;
    seq = 0;
    chain = Promise.resolve();
  }

  return { fakeDb, state, flags, resetFake };
});

vi.mock("@/lib/server/db", () => ({ db: fakeDb }));

import {
  MemberJoinRequestAlreadyDecidedError,
  MemberJoinRequestAuthorizationError,
  MemberJoinRequestDecisionConflictError,
  MemberJoinRequestError,
  MemberJoinRequestNotFoundError,
  MemberJoinRequestValidationError,
  approveJoinRequest,
  listPendingJoinRequests,
  rejectJoinRequest,
  submitJoinRequest,
} from "@/lib/server/member-join-requests";

const ORG_A = "org-a";
const ORG_B = "org-b";
const PHONE = "9876543210";

const VALID = {
  name: "New Person",
  requestedPlan: "MONTHLY",
  proposedFee: "1500",
  proposedStartDate: "2026-11-01",
};

function input(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG_A,
    challengeId: "challenge-1",
    ...VALID,
    ...overrides,
  } as Parameters<typeof submitJoinRequest>[0];
}

function seedChallenge(overrides: Record<string, unknown> = {}) {
  const challenge = {
    id: "challenge-1",
    organizationId: ORG_A,
    phoneNumber: PHONE,
    providerSessionId: "provider-session-xyz",
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
    name: "Existing Member",
    phoneNumber: PHONE,
    ...overrides,
  };
  state.members.push(member);
  return member;
}

beforeEach(() => {
  resetFake();
});

describe("submitJoinRequest — validation runs before any database write", () => {
  it("rejects each invalid field with its per-field message and never opens a transaction", async () => {
    seedChallenge();
    const cases: [Record<string, unknown>, string][] = [
      [{ name: "   " }, "name"],
      [{ name: "x".repeat(121) }, "name"],
      [{ requestedPlan: "WEEKLY" }, "plan"],
      [{ requestedPlan: "" }, "plan"],
      [{ proposedFee: "abc" }, "fee"],
      [{ proposedFee: "-5" }, "fee"],
      [{ proposedFee: "1.234" }, "fee"],
      [{ proposedStartDate: "" }, "startDate"],
      [{ proposedStartDate: "2026-02-30" }, "startDate"],
      [{ proposedStartDate: "01/11/2026" }, "startDate"],
    ];
    for (const [overrides, field] of cases) {
      const error = await submitJoinRequest(input(overrides)).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(MemberJoinRequestValidationError);
      expect(
        typeof (error as MemberJoinRequestValidationError).fields[
          field as "name" | "plan" | "fee" | "startDate"
        ],
      ).toBe("string");
    }
    expect(flags.transactionCalls).toBe(0);
    expect(state.challenges[0]?.consumedAt).toBeNull();
    expect(state.joinRequests).toHaveLength(0);
    expect(state.users).toHaveLength(0);
  });

  it("accumulates multiple field errors at once", async () => {
    seedChallenge();
    const error = await submitJoinRequest(
      input({ name: "", requestedPlan: "NOPE", proposedFee: "x" }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MemberJoinRequestValidationError);
    const fields = (error as MemberJoinRequestValidationError).fields;
    expect(Object.keys(fields).sort()).toEqual(["fee", "name", "plan"]);
  });

  it("accepts a fee with paise and trims the name, like member creation", async () => {
    seedChallenge();
    const result = await submitJoinRequest(
      input({ name: "  New Person  ", proposedFee: "1500.50" }),
    );
    expect(result.status).toBe("created");
    expect(state.joinRequests[0]?.name).toBe("New Person");
    expect(state.joinRequests[0]?.proposedFee).toBe("1500.5");
  });
});

describe("submitJoinRequest — happy path", () => {
  it("creates the request + audit, consumes the challenge, and creates only the phone-shell user", async () => {
    seedChallenge();
    const result = await submitJoinRequest(input());
    expect(result.status).toBe("created");
    const requestId =
      result.status === "created" ? result.requestId : "";

    expect(state.joinRequests).toHaveLength(1);
    const request = state.joinRequests[0]!;
    expect(request.id).toBe(requestId);
    expect(request).toMatchObject({
      organizationId: ORG_A,
      phoneNumber: PHONE,
      name: "New Person",
      requestedPlan: "MONTHLY",
      proposedFee: "1500",
      status: "PENDING",
    });
    expect((request.proposedStartDate as Date).toISOString()).toBe(
      "2026-11-01T00:00:00.000Z",
    );

    // The shell user: phone only, no Clerk identity, no membership.
    expect(state.users).toHaveLength(1);
    expect(state.users[0]?.phoneNumber).toBe(PHONE);
    expect(state.users[0]?.clerkUserId).toBeNull();
    expect(request.userId).toBe(state.users[0]?.id);
    expect(state.orgMemberships).toHaveLength(0);

    expect(state.challenges[0]?.consumedAt).toBeInstanceOf(Date);
    expect(state.auditLogs).toHaveLength(1);
    expect(state.auditLogs[0]).toMatchObject({
      event: "MEMBER_JOIN_REQUESTED",
      organizationId: ORG_A,
      actorUserId: state.users[0]?.id,
      targetType: "MemberJoinRequest",
      targetId: requestId,
    });
  });

  it("reuses an existing user for the phone without touching its identity", async () => {
    state.users.push({
      id: "user-existing",
      clerkUserId: "clerk-123",
      phoneNumber: PHONE,
    });
    seedChallenge();
    const result = await submitJoinRequest(input());
    expect(result.status).toBe("created");
    expect(state.users).toHaveLength(1);
    expect(state.users[0]?.clerkUserId).toBe("clerk-123");
    expect(state.joinRequests[0]?.userId).toBe("user-existing");
  });

  it("a pending request in another gym does not block this gym", async () => {
    state.joinRequests.push({
      id: "request-b",
      organizationId: ORG_B,
      userId: "someone",
      phoneNumber: PHONE,
      name: "Other Gym",
      requestedPlan: "MONTHLY",
      proposedFee: "100",
      proposedStartDate: new Date(),
      status: "PENDING",
      createdAt: new Date(),
    });
    seedChallenge();
    const result = await submitJoinRequest(input());
    expect(result.status).toBe("created");
    expect(state.joinRequests).toHaveLength(2);
  });
});

describe("submitJoinRequest — challenge guards are all the same generic failure", () => {
  it("rejects unknown, consumed, non-VERIFIED, out-of-window, and wrong-gym challenges identically", async () => {
    seedChallenge({ id: "c-consumed", consumedAt: new Date() });
    seedChallenge({ id: "c-pending", status: "PENDING", verifiedAt: null });
    seedChallenge({
      id: "c-stale",
      verifiedAt: new Date(Date.now() - 6 * 60_000),
    });
    seedChallenge({ id: "c-other-gym", organizationId: ORG_B });

    for (const challengeId of [
      "c-missing",
      "c-consumed",
      "c-pending",
      "c-stale",
      "c-other-gym",
    ]) {
      await expect(
        submitJoinRequest(input({ challengeId })),
      ).rejects.toBeInstanceOf(MemberJoinRequestError);
    }
    expect(state.joinRequests).toHaveLength(0);
    expect(state.users).toHaveLength(0);
    expect(state.auditLogs).toHaveLength(0);
  });
});

describe("submitJoinRequest — existing-member states create zero rows", () => {
  it("one unlinked candidate → already_registered, everything rolled back", async () => {
    seedChallenge();
    seedMember();
    const result = await submitJoinRequest(input());
    expect(result).toEqual({ status: "already_registered" });
    expect(state.joinRequests).toHaveLength(0);
    expect(state.auditLogs).toHaveLength(0);
    expect(state.users).toHaveLength(0);
    expect(state.challenges[0]?.consumedAt).toBeNull();
    expect(state.members[0]?.userId).toBeNull();
  });

  it("already linked to this user → already_registered", async () => {
    state.users.push({ id: "user-me", clerkUserId: null, phoneNumber: PHONE });
    seedMember({ userId: "user-me" });
    seedChallenge();
    const result = await submitJoinRequest(input());
    expect(result).toEqual({ status: "already_registered" });
    expect(state.joinRequests).toHaveLength(0);
    expect(state.challenges[0]?.consumedAt).toBeNull();
  });

  it("linked to another user → generic failure, no rows", async () => {
    seedMember({ userId: "someone-else" });
    seedChallenge();
    await expect(submitJoinRequest(input())).rejects.toBeInstanceOf(
      MemberJoinRequestError,
    );
    expect(state.joinRequests).toHaveLength(0);
    expect(state.users).toHaveLength(0);
    expect(state.challenges[0]?.consumedAt).toBeNull();
  });

  it("multiple unlinked candidates → already_registered (staff resolve the records, not a request)", async () => {
    seedMember({ id: "member-1" });
    seedMember({ id: "member-2" });
    seedChallenge();
    const result = await submitJoinRequest(input());
    expect(result).toEqual({ status: "already_registered" });
    expect(state.joinRequests).toHaveLength(0);
    expect(state.challenges[0]?.consumedAt).toBeNull();
  });

  it("user already linked to a different member in this gym (other phone) → already_registered", async () => {
    state.users.push({ id: "user-me", clerkUserId: null, phoneNumber: PHONE });
    seedMember({ id: "member-old", userId: "user-me", phoneNumber: "9000000001" });
    seedChallenge();
    const result = await submitJoinRequest(input());
    expect(result).toEqual({ status: "already_registered" });
    expect(state.joinRequests).toHaveLength(0);
  });
});

describe("submitJoinRequest — duplicates and atomicity", () => {
  it("a sequential resubmission resolves to already_pending with one row and one audit; the second challenge stays unconsumed", async () => {
    seedChallenge();
    const first = await submitJoinRequest(input());
    expect(first.status).toBe("created");

    seedChallenge({ id: "challenge-2" });
    const second = await submitJoinRequest(input({ challengeId: "challenge-2" }));
    expect(second.status).toBe("already_pending");
    if (first.status === "created" && second.status === "already_pending") {
      expect(second.requestId).toBe(first.requestId);
    }
    expect(state.joinRequests).toHaveLength(1);
    expect(state.auditLogs).toHaveLength(1);
    expect(state.users).toHaveLength(1);
    expect(
      state.challenges.find((c) => c.id === "challenge-2")?.consumedAt,
    ).toBeNull();
  });

  it("rolls back claim, user, request, and audit when the audit write fails", async () => {
    seedChallenge();
    flags.failAudit = true;
    await expect(submitJoinRequest(input())).rejects.toThrow(
      "audit write failed",
    );
    expect(state.challenges[0]?.consumedAt).toBeNull();
    expect(state.users).toHaveLength(0);
    expect(state.joinRequests).toHaveLength(0);
    expect(state.auditLogs).toHaveLength(0);
  });
});

describe("listPendingJoinRequests — staff queue scope and roles", () => {
  function seedStaff(userId: string, role: string, organizationId = ORG_A) {
    state.orgMemberships.push({
      id: `om-${userId}`,
      userId,
      organizationId,
      role,
    });
  }

  function seedRequest(overrides: Record<string, unknown> = {}) {
    const request = {
      id: `request-${state.joinRequests.length + 1}`,
      organizationId: ORG_A,
      userId: "requester",
      phoneNumber: PHONE,
      name: "Requester",
      requestedPlan: "MONTHLY",
      proposedFee: new Prisma.Decimal("1500"),
      proposedStartDate: new Date(Date.UTC(2026, 10, 1)),
      status: "PENDING",
      createdAt: new Date(Date.UTC(2026, 9, 17)),
      ...overrides,
    };
    state.joinRequests.push(request);
    return request;
  }

  it("returns the actor's gym pending requests oldest first, with the total", async () => {
    seedStaff("owner-1", "OWNER");
    const older = seedRequest({
      id: "request-old",
      createdAt: new Date(Date.UTC(2026, 9, 15)),
    });
    const newer = seedRequest({ id: "request-new" });
    seedRequest({ id: "request-b", organizationId: ORG_B });
    seedRequest({ id: "request-decided", status: "REJECTED" });

    const { requests, totalPending } = await listPendingJoinRequests("owner-1");
    expect(totalPending).toBe(2);
    expect(requests.map((r) => r.id)).toEqual([older.id, newer.id]);
    expect(requests[0]).toMatchObject({
      name: "Requester",
      phoneNumber: PHONE,
      requestedPlan: "MONTHLY",
      proposedFeePaise: 150000,
    });
  });

  it("allows OWNER, ADMIN, and STAFF; denies TRAINER, MEMBER, and non-members", async () => {
    seedRequest();
    for (const role of ["OWNER", "ADMIN", "STAFF"]) {
      resetFake();
      seedRequest();
      seedStaff(`user-${role}`, role);
      const { totalPending } = await listPendingJoinRequests(`user-${role}`);
      expect(totalPending).toBe(1);
    }
    for (const role of ["TRAINER", "MEMBER"]) {
      resetFake();
      seedRequest();
      seedStaff(`user-${role}`, role);
      await expect(
        listPendingJoinRequests(`user-${role}`),
      ).rejects.toBeInstanceOf(MemberJoinRequestAuthorizationError);
    }
    resetFake();
    seedRequest();
    await expect(listPendingJoinRequests("no-membership")).rejects.toBeInstanceOf(
      MemberJoinRequestAuthorizationError,
    );
    await expect(listPendingJoinRequests("")).rejects.toBeInstanceOf(
      MemberJoinRequestAuthorizationError,
    );
  });

  it("caps the list at 100 while reporting the full pending total", async () => {
    seedStaff("owner-1", "OWNER");
    for (let i = 0; i < 105; i += 1) {
      seedRequest({
        id: `request-${i}`,
        phoneNumber: `9000000${String(i).padStart(3, "0")}`,
        createdAt: new Date(Date.UTC(2026, 9, 17, 0, i)),
      });
    }
    const { requests, totalPending } = await listPendingJoinRequests("owner-1");
    expect(requests).toHaveLength(100);
    expect(totalPending).toBe(105);
  });
});

describe("decisions (Slice 2) — approve / reject against the fake", () => {
  const TERMS = { plan: "MONTHLY", fee: "1500", startDate: "2026-11-01" };

  function seedDecider(
    userId: string,
    role: string,
    organizationId: string = ORG_A,
  ) {
    state.orgMemberships.push({
      id: `om-${userId}-${organizationId}`,
      userId,
      organizationId,
      role,
    });
  }

  function seedPendingRequest(overrides: Record<string, unknown> = {}) {
    const request = {
      id: "request-1",
      organizationId: ORG_A,
      userId: "requester-1",
      phoneNumber: PHONE,
      name: "New Person",
      requestedPlan: "MONTHLY",
      // String form, per the fake's convention: a real Decimal in
      // state would defeat the transaction snapshot (structuredClone).
      proposedFee: "1500",
      proposedStartDate: new Date(Date.UTC(2026, 10, 1)),
      status: "PENDING",
      decidedByUserId: null,
      decidedAt: null,
      resultingMemberId: null,
      createdAt: new Date(Date.UTC(2026, 9, 17)),
      updatedAt: new Date(Date.UTC(2026, 9, 17)),
      ...overrides,
    };
    state.joinRequests.push(request);
    return request;
  }

  it("validates the confirmed terms before opening a transaction", async () => {
    seedDecider("owner-1", "OWNER");
    seedPendingRequest();
    const cases: [Record<string, string>, string][] = [
      [{ plan: "WEEKLY" }, "plan"],
      [{ plan: "" }, "plan"],
      [{ fee: "abc" }, "fee"],
      [{ fee: "-5" }, "fee"],
      [{ startDate: "" }, "startDate"],
      [{ startDate: "2026-02-30" }, "startDate"],
    ];
    for (const [overrides, field] of cases) {
      const error = await approveJoinRequest("owner-1", "request-1", {
        ...TERMS,
        ...overrides,
      }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(MemberJoinRequestValidationError);
      expect(
        typeof (error as MemberJoinRequestValidationError).fields[
          field as "plan" | "fee" | "startDate"
        ],
      ).toBe("string");
    }
    expect(flags.transactionCalls).toBe(0);
    expect(state.joinRequests[0]?.status).toBe("PENDING");
    expect(state.members).toHaveLength(0);
    expect(state.memberships).toHaveLength(0);
  });

  it("approves by creating the member, first membership, and audit atomically", async () => {
    seedDecider("owner-1", "OWNER");
    seedPendingRequest();

    const result = await approveJoinRequest("owner-1", "request-1", TERMS);
    expect(result.adoptedExistingMember).toBe(false);
    expect(result.requestId).toBe("request-1");

    const member = state.members[0];
    expect(member).toMatchObject({
      organizationId: ORG_A,
      name: "New Person",
      phoneNumber: PHONE,
      userId: "requester-1",
    });
    expect(result.memberId).toBe(member?.id);

    const membership = state.memberships[0];
    expect(membership).toMatchObject({
      organizationId: ORG_A,
      memberId: member?.id,
      plan: "MONTHLY",
    });
    expect(String(membership?.fee)).toBe("1500");
    expect((membership?.startDate as Date).toISOString()).toBe(
      "2026-11-01T00:00:00.000Z",
    );
    // Expiry derived by the shared rule: start + one calendar month.
    expect((membership?.expiryDate as Date).toISOString()).toBe(
      "2026-12-01T00:00:00.000Z",
    );
    expect(result.membershipId).toBe(membership?.id);

    const request = state.joinRequests[0];
    expect(request).toMatchObject({
      status: "APPROVED",
      decidedByUserId: "owner-1",
      resultingMemberId: member?.id,
    });
    expect(request?.decidedAt).toBeInstanceOf(Date);

    expect(state.auditLogs).toHaveLength(1);
    expect(state.auditLogs[0]).toMatchObject({
      organizationId: ORG_A,
      actorUserId: "owner-1",
      event: "MEMBER_JOIN_REQUEST_APPROVED",
      targetType: "MemberJoinRequest",
      targetId: "request-1",
    });
    const metadata = state.auditLogs[0]?.metadata as Record<string, unknown>;
    expect(metadata).toMatchObject({
      memberId: member?.id,
      plan: "MONTHLY",
      feePaise: 150000,
      adoptedExistingMember: false,
    });
  });

  it("derives the expiry with the month-end clamp (Jan 31 + MONTHLY → Feb 28)", async () => {
    seedDecider("owner-1", "OWNER");
    seedPendingRequest();
    await approveJoinRequest("owner-1", "request-1", {
      plan: "MONTHLY",
      fee: "1500",
      startDate: "2027-01-31",
    });
    expect((state.memberships[0]?.expiryDate as Date).toISOString()).toBe(
      "2027-02-28T00:00:00.000Z",
    );
  });

  it("adopts the single unlinked record without touching its name", async () => {
    seedDecider("owner-1", "OWNER");
    seedPendingRequest();
    const existing = seedMember({ name: "Staff Recorded Name" });

    const result = await approveJoinRequest("owner-1", "request-1", TERMS);
    expect(result.adoptedExistingMember).toBe(true);
    expect(result.memberId).toBe(existing.id);
    expect(state.members).toHaveLength(1);
    expect(state.members[0]).toMatchObject({
      id: existing.id,
      name: "Staff Recorded Name",
      userId: "requester-1",
    });
  });

  it("approves against the record already linked to the requester", async () => {
    seedDecider("owner-1", "OWNER");
    seedPendingRequest();
    const existing = seedMember({ userId: "requester-1" });

    const result = await approveJoinRequest("owner-1", "request-1", TERMS);
    expect(result.adoptedExistingMember).toBe(false);
    expect(result.memberId).toBe(existing.id);
    expect(state.members).toHaveLength(1);
    expect(state.memberships).toHaveLength(1);
  });

  it("conflicts when the phone's record is linked to another user; request stays PENDING", async () => {
    seedDecider("owner-1", "OWNER");
    seedPendingRequest();
    seedMember({ userId: "someone-else" });

    const error = await approveJoinRequest(
      "owner-1",
      "request-1",
      TERMS,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MemberJoinRequestDecisionConflictError);
    expect(
      (error as MemberJoinRequestDecisionConflictError).reason,
    ).toBe("member_linked_elsewhere");
    expect(state.joinRequests[0]?.status).toBe("PENDING");
    expect(state.memberships).toHaveLength(0);
    expect(state.auditLogs).toHaveLength(0);
  });

  it("conflicts on duplicate unlinked records instead of merging them", async () => {
    seedDecider("owner-1", "OWNER");
    seedPendingRequest();
    seedMember({ name: "Dup One" });
    seedMember({ name: "Dup Two" });

    const error = await approveJoinRequest(
      "owner-1",
      "request-1",
      TERMS,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MemberJoinRequestDecisionConflictError);
    expect(
      (error as MemberJoinRequestDecisionConflictError).reason,
    ).toBe("duplicate_member_records");
    expect(state.members.every((m) => m.userId === null)).toBe(true);
    expect(state.joinRequests[0]?.status).toBe("PENDING");
  });

  it("conflicts when the member already has a membership (D2)", async () => {
    seedDecider("owner-1", "OWNER");
    seedPendingRequest();
    const existing = seedMember({ userId: "requester-1" });
    state.memberships.push({
      id: "membership-existing",
      organizationId: ORG_A,
      memberId: existing.id,
    });

    const error = await approveJoinRequest(
      "owner-1",
      "request-1",
      TERMS,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MemberJoinRequestDecisionConflictError);
    expect(
      (error as MemberJoinRequestDecisionConflictError).reason,
    ).toBe("member_has_membership");
    expect(state.memberships).toHaveLength(1);
    expect(state.joinRequests[0]?.status).toBe("PENDING");
    expect(state.auditLogs).toHaveLength(0);
  });

  it("hides foreign and nonexistent requests behind the same not-found error", async () => {
    seedDecider("owner-1", "OWNER");
    seedPendingRequest({ id: "request-b", organizationId: ORG_B });

    await expect(
      approveJoinRequest("owner-1", "request-b", TERMS),
    ).rejects.toBeInstanceOf(MemberJoinRequestNotFoundError);
    await expect(
      approveJoinRequest("owner-1", "no-such-request", TERMS),
    ).rejects.toBeInstanceOf(MemberJoinRequestNotFoundError);
    await expect(
      rejectJoinRequest("owner-1", "request-b"),
    ).rejects.toBeInstanceOf(MemberJoinRequestNotFoundError);
  });

  it("denies TRAINER and MEMBER deciders; the request stays PENDING", async () => {
    for (const role of ["TRAINER", "MEMBER"]) {
      resetFake();
      seedDecider("decider-1", role);
      seedPendingRequest();
      await expect(
        approveJoinRequest("decider-1", "request-1", TERMS),
      ).rejects.toBeInstanceOf(MemberJoinRequestAuthorizationError);
      await expect(
        rejectJoinRequest("decider-1", "request-1"),
      ).rejects.toBeInstanceOf(MemberJoinRequestAuthorizationError);
      expect(state.joinRequests[0]?.status).toBe("PENDING");
    }
  });

  it("rejects with decision fields and audit, creating nothing", async () => {
    seedDecider("staff-1", "STAFF");
    seedPendingRequest();

    const result = await rejectJoinRequest("staff-1", "request-1");
    expect(result).toEqual({ requestId: "request-1" });
    const request = state.joinRequests[0];
    expect(request).toMatchObject({
      status: "REJECTED",
      decidedByUserId: "staff-1",
      resultingMemberId: null,
    });
    expect(request?.decidedAt).toBeInstanceOf(Date);
    expect(state.members).toHaveLength(0);
    expect(state.memberships).toHaveLength(0);
    expect(state.auditLogs).toHaveLength(1);
    expect(state.auditLogs[0]).toMatchObject({
      actorUserId: "staff-1",
      event: "MEMBER_JOIN_REQUEST_REJECTED",
      targetId: "request-1",
    });
  });

  it("a second decision on a decided request fails as already-decided", async () => {
    seedDecider("owner-1", "OWNER");
    seedPendingRequest();
    await approveJoinRequest("owner-1", "request-1", TERMS);

    await expect(
      approveJoinRequest("owner-1", "request-1", TERMS),
    ).rejects.toBeInstanceOf(MemberJoinRequestAlreadyDecidedError);
    await expect(
      rejectJoinRequest("owner-1", "request-1"),
    ).rejects.toBeInstanceOf(MemberJoinRequestAlreadyDecidedError);
    expect(state.members).toHaveLength(1);
    expect(state.memberships).toHaveLength(1);
    expect(state.auditLogs).toHaveLength(1);
  });

  it("an audit failure rolls the whole approval back (atomicity)", async () => {
    seedDecider("owner-1", "OWNER");
    seedPendingRequest();
    flags.failAudit = true;

    await expect(
      approveJoinRequest("owner-1", "request-1", TERMS),
    ).rejects.toThrow("audit write failed");
    expect(state.joinRequests[0]?.status).toBe("PENDING");
    expect(state.joinRequests[0]?.resultingMemberId).toBeNull();
    expect(state.members).toHaveLength(0);
    expect(state.memberships).toHaveLength(0);
  });
});
