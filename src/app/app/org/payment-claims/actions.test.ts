import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireCurrentUser,
  mockConfirmClaim,
  mockRejectClaim,
  mockRevalidatePath,
} = vi.hoisted(() => ({
  mockRequireCurrentUser: vi.fn(),
  mockConfirmClaim: vi.fn(),
  mockRejectClaim: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({
  requireCurrentUser: mockRequireCurrentUser,
}));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));
vi.mock("@/lib/server/payment-claims", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/server/payment-claims")>();
  return {
    ...original,
    confirmPaymentClaim: mockConfirmClaim,
    rejectPaymentClaim: mockRejectClaim,
  };
});

import { PaymentValidationError } from "@/lib/members";
import {
  PaymentClaimAuthorizationError,
  PaymentClaimConflictError,
  PaymentClaimNotFoundError,
} from "@/lib/server/payment-claims";

import { confirmClaimAction, rejectClaimAction } from "./actions";
import { INITIAL_CLAIM_DECISION_STATE } from "./payment-claims-action-state";

const STAFF_ID = "staff-user-1";
const CLAIMS_PATH = "/app/org/payment-claims";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireCurrentUser.mockResolvedValue({ id: STAFF_ID });
  mockConfirmClaim.mockResolvedValue({
    claimId: "claim-1",
    paymentId: "payment-1",
  });
  mockRejectClaim.mockResolvedValue({ claimId: "claim-1" });
});

describe("confirmClaimAction", () => {
  it("resolves the actor server-side and ignores forged identity fields", async () => {
    const state = await confirmClaimAction(
      INITIAL_CLAIM_DECISION_STATE,
      form({
        claimId: "claim-1",
        memberId: "member-1",
        amount: "450",
        userId: "forged-user",
        organizationId: "forged-org",
      }),
    );
    expect(state.ok).toBe(true);
    expect(mockConfirmClaim).toHaveBeenCalledTimes(1);
    expect(mockConfirmClaim).toHaveBeenCalledWith(STAFF_ID, "claim-1", {
      amount: "450",
    });
  });

  it("passes no amount override when the field is blank (service defaults to the claimed amount)", async () => {
    await confirmClaimAction(
      INITIAL_CLAIM_DECISION_STATE,
      form({ claimId: "claim-1", amount: "  " }),
    );
    expect(mockConfirmClaim).toHaveBeenCalledWith(
      STAFF_ID,
      "claim-1",
      undefined,
    );
  });

  it("revalidates only the fixed queue and members-list paths on success", async () => {
    await confirmClaimAction(
      INITIAL_CLAIM_DECISION_STATE,
      form({ claimId: "claim-1", memberId: "member-1", amount: "450" }),
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith(CLAIMS_PATH);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/app/org/members");
    expect(mockRevalidatePath).not.toHaveBeenCalledWith(
      "/app/org/members/member-1",
    );
  });

  it("maps validation failures to field errors", async () => {
    mockConfirmClaim.mockRejectedValue(
      new PaymentValidationError({
        amount: "Amount must be a valid amount, for example 6000 or 6000.50.",
      }),
    );
    const state = await confirmClaimAction(
      INITIAL_CLAIM_DECISION_STATE,
      form({ claimId: "claim-1", amount: "abc" }),
    );
    expect(state.ok).toBe(false);
    expect(state.errors.amount).toContain("valid amount");
  });

  it("maps an already-decided conflict to the decided message and refreshes the queue", async () => {
    mockConfirmClaim.mockRejectedValue(new PaymentClaimConflictError());
    const state = await confirmClaimAction(
      INITIAL_CLAIM_DECISION_STATE,
      form({ claimId: "claim-1", memberId: "member-1", amount: "450" }),
    );
    expect(state.ok).toBe(false);
    expect(state.message).toBe("This claim has already been decided.");
    expect(mockRevalidatePath).toHaveBeenCalledWith(CLAIMS_PATH);
  });

  it("maps authorization and not-found to the same safe message (TRAINER/MEMBER denial lands here)", async () => {
    mockConfirmClaim.mockRejectedValue(
      new PaymentClaimAuthorizationError("nope"),
    );
    const denied = await confirmClaimAction(
      INITIAL_CLAIM_DECISION_STATE,
      form({ claimId: "claim-1", amount: "1" }),
    );
    expect(denied.message).toBe("This claim is no longer available.");

    mockConfirmClaim.mockRejectedValue(
      new PaymentClaimNotFoundError("not here"),
    );
    const missing = await confirmClaimAction(
      INITIAL_CLAIM_DECISION_STATE,
      form({ claimId: "claim-9", amount: "1" }),
    );
    expect(missing.message).toBe("This claim is no longer available.");
  });

  it("maps unexpected failures to a generic message without internals", async () => {
    mockConfirmClaim.mockRejectedValue(
      new Error("postgres connection string exploded"),
    );
    const state = await confirmClaimAction(
      INITIAL_CLAIM_DECISION_STATE,
      form({ claimId: "claim-1", amount: "1" }),
    );
    expect(state.ok).toBe(false);
    expect(state.message).toBe("Something went wrong. Please try again.");
    expect(state.message).not.toContain("postgres");
  });

  it("refuses a missing claim id without calling the service", async () => {
    const state = await confirmClaimAction(
      INITIAL_CLAIM_DECISION_STATE,
      form({ amount: "1" }),
    );
    expect(state.message).toBe("This claim is no longer available.");
    expect(mockConfirmClaim).not.toHaveBeenCalled();
  });
});

describe("rejectClaimAction", () => {
  it("rejects via the service with the server-side actor and revalidates", async () => {
    const state = await rejectClaimAction(
      INITIAL_CLAIM_DECISION_STATE,
      form({ claimId: "claim-1", memberId: "member-1", userId: "forged" }),
    );
    expect(state.ok).toBe(true);
    expect(state.message).toBe("Claim rejected.");
    expect(mockRejectClaim).toHaveBeenCalledWith(STAFF_ID, "claim-1");
    expect(mockRevalidatePath).toHaveBeenCalledWith(CLAIMS_PATH);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/app/org/members");
    expect(mockRevalidatePath).not.toHaveBeenCalledWith(
      "/app/org/members/member-1",
    );
  });

  it("maps a reject conflict to the decided message", async () => {
    mockRejectClaim.mockRejectedValue(new PaymentClaimConflictError());
    const state = await rejectClaimAction(
      INITIAL_CLAIM_DECISION_STATE,
      form({ claimId: "claim-1" }),
    );
    expect(state.message).toBe("This claim has already been decided.");
  });

  it("maps authorization denial to the safe message", async () => {
    mockRejectClaim.mockRejectedValue(
      new PaymentClaimAuthorizationError("nope"),
    );
    const state = await rejectClaimAction(
      INITIAL_CLAIM_DECISION_STATE,
      form({ claimId: "claim-1" }),
    );
    expect(state.message).toBe("This claim is no longer available.");
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
      expect([CLAIMS_PATH, "/app/org/members"]).toContain(path);
      expect(path).not.toContain("forged");
    }
  }

  it("a forged memberId cannot influence confirm revalidation targets", async () => {
    await confirmClaimAction(
      INITIAL_CLAIM_DECISION_STATE,
      form({ claimId: "claim-1", memberId: FORGED, amount: "450" }),
    );
    expectOnlyFixedPaths();
  });

  it("a forged memberId cannot influence reject revalidation targets", async () => {
    await rejectClaimAction(
      INITIAL_CLAIM_DECISION_STATE,
      form({ claimId: "claim-1", memberId: FORGED }),
    );
    expectOnlyFixedPaths();
  });

  it("a forged memberId cannot influence conflict-path revalidation either", async () => {
    mockConfirmClaim.mockRejectedValue(new PaymentClaimConflictError());
    await confirmClaimAction(
      INITIAL_CLAIM_DECISION_STATE,
      form({ claimId: "claim-1", memberId: FORGED, amount: "450" }),
    );
    expectOnlyFixedPaths();
  });
});
