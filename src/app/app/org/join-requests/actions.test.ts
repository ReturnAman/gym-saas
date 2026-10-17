import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireCurrentUser,
  mockApproveJoinRequest,
  mockRejectJoinRequest,
  mockRevalidatePath,
} = vi.hoisted(() => ({
  mockRequireCurrentUser: vi.fn(),
  mockApproveJoinRequest: vi.fn(),
  mockRejectJoinRequest: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({
  requireCurrentUser: mockRequireCurrentUser,
}));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));
vi.mock("@/lib/server/member-join-requests", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/server/member-join-requests")>();
  return {
    ...original,
    approveJoinRequest: mockApproveJoinRequest,
    rejectJoinRequest: mockRejectJoinRequest,
  };
});

import {
  MemberJoinRequestAlreadyDecidedError,
  MemberJoinRequestAuthorizationError,
  MemberJoinRequestDecisionConflictError,
  MemberJoinRequestNotFoundError,
  MemberJoinRequestValidationError,
} from "@/lib/server/member-join-requests";

import {
  approveJoinRequestAction,
  rejectJoinRequestAction,
} from "./actions";
import { INITIAL_JOIN_REQUEST_DECISION_STATE } from "./join-requests-action-state";

const STAFF_ID = "staff-user-1";
const QUEUE_PATH = "/app/org/join-requests";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

const TERMS_FORM = {
  requestId: "request-1",
  plan: "MONTHLY",
  fee: "1500",
  startDate: "2026-11-01",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireCurrentUser.mockResolvedValue({ id: STAFF_ID });
  mockApproveJoinRequest.mockResolvedValue({
    requestId: "request-1",
    memberId: "member-1",
    membershipId: "membership-1",
    adoptedExistingMember: false,
  });
  mockRejectJoinRequest.mockResolvedValue({ requestId: "request-1" });
});

describe("approveJoinRequestAction", () => {
  it("resolves the actor server-side and forwards only the confirmed terms", async () => {
    const state = await approveJoinRequestAction(
      INITIAL_JOIN_REQUEST_DECISION_STATE,
      form({
        ...TERMS_FORM,
        userId: "forged-user",
        organizationId: "forged-org",
        memberId: "forged-member",
      }),
    );
    expect(state.ok).toBe(true);
    expect(state.message).toContain("No payment has been recorded");
    expect(mockApproveJoinRequest).toHaveBeenCalledTimes(1);
    expect(mockApproveJoinRequest).toHaveBeenCalledWith(STAFF_ID, "request-1", {
      plan: "MONTHLY",
      fee: "1500",
      startDate: "2026-11-01",
    });
  });

  it("passes field-validation errors through to the form state", async () => {
    mockApproveJoinRequest.mockRejectedValue(
      new MemberJoinRequestValidationError({
        fee: "Fee must be a valid amount, for example 6000 or 6000.50.",
        startDate: "Start date is required. Choose a valid start date.",
      }),
    );
    const state = await approveJoinRequestAction(
      INITIAL_JOIN_REQUEST_DECISION_STATE,
      form({ ...TERMS_FORM, fee: "abc", startDate: "" }),
    );
    expect(state.ok).toBe(false);
    expect(state.errors.fee).toContain("valid amount");
    expect(state.errors.startDate).toContain("required");
  });

  it("maps an already-decided error to the decided message and refreshes the queue", async () => {
    mockApproveJoinRequest.mockRejectedValue(
      new MemberJoinRequestAlreadyDecidedError(),
    );
    const state = await approveJoinRequestAction(
      INITIAL_JOIN_REQUEST_DECISION_STATE,
      form(TERMS_FORM),
    );
    expect(state.ok).toBe(false);
    expect(state.message).toBe("This request has already been decided.");
    expect(mockRevalidatePath).toHaveBeenCalledWith(QUEUE_PATH);
  });

  it("maps each decision conflict to its own plain-language message", async () => {
    const cases: [
      InstanceType<typeof MemberJoinRequestDecisionConflictError>["reason"],
      string,
    ][] = [
      ["member_has_membership", "already has a membership"],
      ["duplicate_member_records", "multiple member records"],
      ["member_linked_elsewhere", "linked to a different member account"],
    ];
    for (const [reason, fragment] of cases) {
      mockApproveJoinRequest.mockRejectedValue(
        new MemberJoinRequestDecisionConflictError(reason),
      );
      const state = await approveJoinRequestAction(
        INITIAL_JOIN_REQUEST_DECISION_STATE,
        form(TERMS_FORM),
      );
      expect(state.ok).toBe(false);
      expect(state.message).toContain(fragment);
      expect(state.message).toContain("still pending");
    }
  });

  it("maps authorization and not-found to the same safe message (TRAINER denial and foreign IDs land here)", async () => {
    mockApproveJoinRequest.mockRejectedValue(
      new MemberJoinRequestAuthorizationError("nope"),
    );
    const denied = await approveJoinRequestAction(
      INITIAL_JOIN_REQUEST_DECISION_STATE,
      form(TERMS_FORM),
    );
    expect(denied.message).toBe("This request is no longer available.");

    mockApproveJoinRequest.mockRejectedValue(
      new MemberJoinRequestNotFoundError(),
    );
    const missing = await approveJoinRequestAction(
      INITIAL_JOIN_REQUEST_DECISION_STATE,
      form({ ...TERMS_FORM, requestId: "request-9" }),
    );
    expect(missing.message).toBe("This request is no longer available.");
  });

  it("maps a lost-connection failure to the ambiguous check-first message and refreshes the queue", async () => {
    // The shape classifyDatabaseError reads as a connection failure
    // (Prisma P1001 — see db-errors): the decision may have committed.
    const error = Object.assign(new Error("Can't reach database server"), {
      code: "P1001",
    });
    mockApproveJoinRequest.mockRejectedValue(error);
    const state = await approveJoinRequestAction(
      INITIAL_JOIN_REQUEST_DECISION_STATE,
      form(TERMS_FORM),
    );
    expect(state.ok).toBe(false);
    expect(state.message).toContain("couldn't confirm whether this decision");
    expect(state.message).toContain("still pending");
    expect(mockRevalidatePath).toHaveBeenCalledWith(QUEUE_PATH);
  });

  it("maps unexpected failures to a generic message without internals", async () => {
    mockApproveJoinRequest.mockRejectedValue(
      new Error("postgres connection string exploded"),
    );
    const state = await approveJoinRequestAction(
      INITIAL_JOIN_REQUEST_DECISION_STATE,
      form(TERMS_FORM),
    );
    expect(state.ok).toBe(false);
    expect(state.message).toBe("Something went wrong. Please try again.");
    expect(state.message).not.toContain("postgres");
  });

  it("refuses a missing request id without calling the service", async () => {
    const state = await approveJoinRequestAction(
      INITIAL_JOIN_REQUEST_DECISION_STATE,
      form({ plan: "MONTHLY", fee: "1500", startDate: "2026-11-01" }),
    );
    expect(state.message).toBe("This request is no longer available.");
    expect(mockApproveJoinRequest).not.toHaveBeenCalled();
  });
});

describe("rejectJoinRequestAction", () => {
  it("rejects via the service with the server-side actor and revalidates", async () => {
    const state = await rejectJoinRequestAction(
      INITIAL_JOIN_REQUEST_DECISION_STATE,
      form({ requestId: "request-1", userId: "forged" }),
    );
    expect(state.ok).toBe(true);
    expect(state.message).toBe("Request rejected.");
    expect(mockRejectJoinRequest).toHaveBeenCalledWith(STAFF_ID, "request-1");
    expect(mockRevalidatePath).toHaveBeenCalledWith(QUEUE_PATH);
  });

  it("maps a reject conflict (already decided) to the decided message", async () => {
    mockRejectJoinRequest.mockRejectedValue(
      new MemberJoinRequestAlreadyDecidedError(),
    );
    const state = await rejectJoinRequestAction(
      INITIAL_JOIN_REQUEST_DECISION_STATE,
      form({ requestId: "request-1" }),
    );
    expect(state.message).toBe("This request has already been decided.");
  });

  it("maps authorization denial to the safe message", async () => {
    mockRejectJoinRequest.mockRejectedValue(
      new MemberJoinRequestAuthorizationError("nope"),
    );
    const state = await rejectJoinRequestAction(
      INITIAL_JOIN_REQUEST_DECISION_STATE,
      form({ requestId: "request-1" }),
    );
    expect(state.message).toBe("This request is no longer available.");
  });
});

describe("trusted revalidation targets (regression)", () => {
  const FORGED = "../../members/forged-member-id";

  function revalidatedPaths(): string[] {
    return mockRevalidatePath.mock.calls.map((call) => String(call[0]));
  }

  function expectOnlyFixedPaths() {
    const paths = revalidatedPaths();
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect([QUEUE_PATH, "/app/org/members"]).toContain(path);
      expect(path).not.toContain("forged");
    }
  }

  it("a forged memberId cannot influence approve revalidation targets", async () => {
    await approveJoinRequestAction(
      INITIAL_JOIN_REQUEST_DECISION_STATE,
      form({ ...TERMS_FORM, requestId: FORGED }),
    );
    expectOnlyFixedPaths();
  });

  it("a forged memberId cannot influence reject revalidation targets", async () => {
    await rejectJoinRequestAction(
      INITIAL_JOIN_REQUEST_DECISION_STATE,
      form({ requestId: FORGED }),
    );
    expectOnlyFixedPaths();
  });

  it("a forged memberId cannot influence decided-path revalidation either", async () => {
    mockApproveJoinRequest.mockRejectedValue(
      new MemberJoinRequestAlreadyDecidedError(),
    );
    await approveJoinRequestAction(
      INITIAL_JOIN_REQUEST_DECISION_STATE,
      form({ ...TERMS_FORM, requestId: FORGED }),
    );
    expectOnlyFixedPaths();
  });
});
