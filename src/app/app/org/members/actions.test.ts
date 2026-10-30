import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

/**
 * recordPaymentAction — database-failure behaviour (H2).
 *
 * The payment may have committed when the connection died around the
 * write, so a connection failure must produce the check-first message
 * (and refreshed member pages), never a plain "try again". Definite
 * failures (pool-acquisition / statement timeouts) say plainly that
 * nothing was recorded. Everything else keeps its existing mapping.
 */

const {
  mockRequireCurrentUser,
  mockRecordPayment,
  mockReversePayment,
  mockRenewMembership,
  mockRevalidatePath,
  mockRedirect,
} = vi.hoisted(() => ({
  mockRequireCurrentUser: vi.fn(),
  mockRecordPayment: vi.fn(),
  mockReversePayment: vi.fn(),
  mockRenewMembership: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockRedirect: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/lib/server/auth", () => ({
  requireCurrentUser: mockRequireCurrentUser,
}));
vi.mock("@/lib/server/members", () => {
  class MemberAuthorizationError extends Error {}
  class MemberDuplicateError extends Error {
    duplicates = [];
  }
  class MemberNotFoundError extends Error {
    constructor() {
      super("Member not found.");
    }
  }
  class MemberRenewalConflictError extends Error {}
  return {
    MemberAuthorizationError,
    MemberDuplicateError,
    MemberNotFoundError,
    MemberRenewalConflictError,
    createMemberWithMembership: vi.fn(),
    renewMembership: mockRenewMembership,
    updateMember: vi.fn(),
  };
});
vi.mock("@/lib/server/payments", () => {
  class PaymentAuthorizationError extends Error {}
  class PaymentNotFoundError extends Error {}
  class PaymentIdempotencyConflictError extends Error {}
  class PaymentReversalExceedsError extends Error {
    remainingPaise: number;
    constructor(remainingPaise: number) {
      super("exceeds");
      this.remainingPaise = remainingPaise;
    }
  }
  return {
    PaymentAuthorizationError,
    PaymentIdempotencyConflictError,
    PaymentNotFoundError,
    PaymentReversalExceedsError,
    recordPayment: mockRecordPayment,
    reversePayment: mockReversePayment,
  };
});

import {
  recordPaymentAction,
  renewMembershipAction,
  reversePaymentAction,
} from "@/app/app/org/members/actions";
import {
  MemberValidationError,
  PaymentReversalValidationError,
  PaymentValidationError,
} from "@/lib/members";
import {
  MemberAuthorizationError,
  MemberNotFoundError,
  MemberRenewalConflictError,
} from "@/lib/server/members";
import {
  PaymentAuthorizationError,
  PaymentIdempotencyConflictError,
  PaymentReversalExceedsError,
} from "@/lib/server/payments";

const INITIAL = { ok: false, message: null, errors: {} };

function paymentForm() {
  const form = new FormData();
  form.set("memberId", "member-1");
  form.set("amount", "500");
  form.set("paymentMethod", "UPI");
  form.set("reference", "");
  return form;
}

function dbError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("db failure", {
    code,
    clientVersion: "7.10.0",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  errorSpy.mockClear();
  mockRequireCurrentUser.mockResolvedValue({ id: "owner-1" });
  mockRecordPayment.mockResolvedValue({ paymentId: "pay-1" });
  mockReversePayment.mockResolvedValue({ reversalId: "rev-1" });
  mockRenewMembership.mockResolvedValue({
    memberId: "member-1",
    membershipId: "ms-2",
    previousMembershipId: "ms-1",
  });
});

describe("recordPaymentAction", () => {
  it("on success: revalidates and redirects as before", async () => {
    mockRedirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
    await expect(recordPaymentAction(INITIAL, paymentForm())).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/app/org/members");
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      "/app/org/members/member-1",
    );
  });

  it("connection loss: check-first message + refreshed history, no blind retry", async () => {
    mockRecordPayment.mockRejectedValue(
      dbError("P1001"),
    );
    const state = await recordPaymentAction(INITIAL, paymentForm());
    expect(state.ok).toBe(false);
    expect(state.message).toContain("couldn't confirm whether this payment");
    expect(state.message).toContain("payment history and balance");
    expect(state.message).not.toContain("P1001");
    // The pages staff are sent to check were refreshed.
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      "/app/org/members/member-1",
    );
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("pool timeout: definite not-recorded message", async () => {
    mockRecordPayment.mockRejectedValue(dbError("P2024"));
    const state = await recordPaymentAction(INITIAL, paymentForm());
    expect(state.ok).toBe(false);
    expect(state.message).toContain("was not recorded");
  });

  it("statement timeout: definite not-recorded message", async () => {
    mockRecordPayment.mockRejectedValue(
      new Error("canceling statement due to statement timeout"),
    );
    const state = await recordPaymentAction(INITIAL, paymentForm());
    expect(state.ok).toBe(false);
    expect(state.message).toContain("was not recorded");
  });

  it("validation errors keep their field mapping", async () => {
    mockRecordPayment.mockRejectedValue(
      new PaymentValidationError({ amount: "Enter a valid amount." }),
    );
    const state = await recordPaymentAction(INITIAL, paymentForm());
    expect(state.ok).toBe(false);
    expect(state.errors.amount).toBe("Enter a valid amount.");
  });

  it("authorization errors keep their message", async () => {
    mockRecordPayment.mockRejectedValue(
      new PaymentAuthorizationError("You do not have permission."),
    );
    const state = await recordPaymentAction(INITIAL, paymentForm());
    expect(state.message).toBe("You do not have permission.");
  });

  it("unexpected errors keep the existing generic message", async () => {
    mockRecordPayment.mockRejectedValue(new Error("surprise"));
    const state = await recordPaymentAction(INITIAL, paymentForm());
    expect(state.message).toBe("Could not record the payment. Please try again.");
    expect(state.message).not.toContain("surprise");
  });

  it("forwards the form's idempotency token to the service (H4)", async () => {
    mockRedirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
    const form = paymentForm();
    form.set("idempotencyToken", "123e4567-e89b-42d3-a456-426614174000");
    await expect(recordPaymentAction(INITIAL, form)).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(mockRecordPayment).toHaveBeenCalledWith(
      "owner-1",
      "member-1",
      expect.objectContaining({ amount: "500" }),
      { idempotencyKey: "123e4567-e89b-42d3-a456-426614174000" },
    );
  });

  it("a deduplicated result is a normal success (redirect, no error)", async () => {
    mockRecordPayment.mockResolvedValue({
      paymentId: "pay-1",
      deduplicated: true,
    });
    mockRedirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
    await expect(recordPaymentAction(INITIAL, paymentForm())).rejects.toThrow(
      "NEXT_REDIRECT",
    );
  });

  it("an idempotency conflict gets its own safe message (H4)", async () => {
    mockRecordPayment.mockRejectedValue(new PaymentIdempotencyConflictError());
    const state = await recordPaymentAction(INITIAL, paymentForm());
    expect(state.ok).toBe(false);
    expect(state.message).toContain("already used with different details");
  });

  it("logs a classified database failure once, at the action boundary (H3)", async () => {
    mockRecordPayment.mockRejectedValue(dbError("P1001"));
    await recordPaymentAction(INITIAL, paymentForm());
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const record = JSON.parse(
      errorSpy.mock.calls[0]?.[0] as string,
    ) as Record<string, string>;
    expect(record.event).toBe("database_unavailable");
    expect(record.boundary).toBe("action:recordPayment");
    expect(record.errorKind).toBe("connection");
  });

  it("does not log expected validation failures (H3)", async () => {
    mockRecordPayment.mockRejectedValue(
      new PaymentValidationError({ amount: "Enter a valid amount." }),
    );
    await recordPaymentAction(INITIAL, paymentForm());
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

const REVERSAL_INITIAL = { ok: false, message: null, errors: {} };

function reversalForm(withToken = false) {
  const form = new FormData();
  form.set("memberId", "member-1");
  form.set("paymentId", "pay-1");
  form.set("amount", "300");
  form.set("reason", "WRONG_AMOUNT");
  form.set("explanation", "");
  if (withToken) form.set("idempotencyToken", "tok-reversal-0001-abcd");
  return form;
}

describe("reversePaymentAction", () => {
  it("on success: calls the service with the form fields, revalidates and redirects", async () => {
    mockRedirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
    await expect(
      reversePaymentAction(REVERSAL_INITIAL, reversalForm()),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(mockReversePayment).toHaveBeenCalledWith(
      "owner-1",
      "pay-1",
      { amount: "300", reason: "WRONG_AMOUNT", explanation: "" },
      undefined,
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      "/app/org/members/member-1",
    );
  });

  it("forwards the form's idempotency token to the service", async () => {
    mockRedirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
    await expect(
      reversePaymentAction(REVERSAL_INITIAL, reversalForm(true)),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(mockReversePayment).toHaveBeenCalledWith(
      "owner-1",
      "pay-1",
      { amount: "300", reason: "WRONG_AMOUNT", explanation: "" },
      { idempotencyKey: "tok-reversal-0001-abcd" },
    );
  });

  it("maps validation failures to per-field errors", async () => {
    mockReversePayment.mockRejectedValue(
      new PaymentReversalValidationError({
        reason: "Choose a reason for the reversal.",
      }),
    );
    const state = await reversePaymentAction(REVERSAL_INITIAL, reversalForm());
    expect(state.ok).toBe(false);
    expect(state.errors.reason).toBe("Choose a reason for the reversal.");
  });

  it("maps an over-reversal to the amount field, naming what remains", async () => {
    mockReversePayment.mockRejectedValue(new PaymentReversalExceedsError(20_000));
    const state = await reversePaymentAction(REVERSAL_INITIAL, reversalForm());
    expect(state.errors.amount).toBe(
      "Only ₹200 of this payment can still be reversed.",
    );
  });

  it("maps a fully reversed payment to a clear amount error", async () => {
    mockReversePayment.mockRejectedValue(new PaymentReversalExceedsError(0));
    const state = await reversePaymentAction(REVERSAL_INITIAL, reversalForm());
    expect(state.errors.amount).toBe(
      "This payment has already been fully reversed.",
    );
  });

  it("maps an idempotency conflict to the check-history message", async () => {
    mockReversePayment.mockRejectedValue(new PaymentIdempotencyConflictError());
    const state = await reversePaymentAction(REVERSAL_INITIAL, reversalForm());
    expect(state.message).toContain("already used with different details");
  });

  it("passes authorization failures through as the form message", async () => {
    mockReversePayment.mockRejectedValue(
      new PaymentAuthorizationError(
        "You do not have permission to reverse payments.",
      ),
    );
    const state = await reversePaymentAction(REVERSAL_INITIAL, reversalForm());
    expect(state.message).toBe(
      "You do not have permission to reverse payments.",
    );
  });

  it("connection loss: check-first message, never a blind retry invitation", async () => {
    mockReversePayment.mockRejectedValue(dbError("P1001"));
    const state = await reversePaymentAction(REVERSAL_INITIAL, reversalForm());
    expect(state.ok).toBe(false);
    expect(state.message).toContain(
      "couldn't confirm whether this reversal was recorded",
    );
    expect(state.message).not.toContain("P1001");
  });

  it("pool timeout: states plainly that nothing was recorded", async () => {
    mockReversePayment.mockRejectedValue(dbError("P2024"));
    const state = await reversePaymentAction(REVERSAL_INITIAL, reversalForm());
    expect(state.message).toContain("this reversal was not recorded");
  });
});

const RENEWAL_INITIAL = { ok: false, message: null, errors: {} };

function renewalForm() {
  const form = new FormData();
  form.set("memberId", "member-1");
  form.set("plan", "SIX_MONTHS");
  form.set("fee", "6000");
  form.set("expiryDate", "2027-04-30");
  form.set("idempotencyToken", "550e8400-e29b-41d4-a716-446655440000");
  return form;
}

describe("renewMembershipAction", () => {
  it("on success: forwards fields and the token to the service, revalidates and redirects", async () => {
    mockRedirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
    await expect(
      renewMembershipAction(RENEWAL_INITIAL, renewalForm()),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRenewMembership).toHaveBeenCalledWith("owner-1", "member-1", {
      plan: "SIX_MONTHS",
      fee: "6000",
      expiryDate: "2027-04-30",
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/app/org/members");
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      "/app/org/members/member-1",
    );
  });

  it("maps field validation errors per field", async () => {
    mockRenewMembership.mockRejectedValue(
      new MemberValidationError({
        expiryDate: "Expiry date must not be before the new period's start date (2026-11-01).",
      }),
    );
    const state = await renewMembershipAction(RENEWAL_INITIAL, renewalForm());
    expect(state.ok).toBe(false);
    expect(state.errors.expiryDate).toContain("start date");
    expect(state.message).toBeNull();
  });

  it("maps a form-level validation error to the message", async () => {
    mockRenewMembership.mockRejectedValue(
      new MemberValidationError({
        form: "This renewal submission is missing its confirmation token. Refresh the page and try again.",
      }),
    );
    const state = await renewMembershipAction(RENEWAL_INITIAL, renewalForm());
    expect(state.message).toContain("missing its confirmation token");
    expect(state.errors).toEqual({});
  });

  it("maps an idempotency conflict to the check-first message", async () => {
    mockRenewMembership.mockRejectedValue(new MemberRenewalConflictError());
    const state = await renewMembershipAction(RENEWAL_INITIAL, renewalForm());
    expect(state.ok).toBe(false);
    expect(state.message).toContain("already used with different details");
  });

  it("passes authorization and not-found messages through", async () => {
    mockRenewMembership.mockRejectedValue(
      new MemberAuthorizationError("You do not have permission to renew memberships."),
    );
    let state = await renewMembershipAction(RENEWAL_INITIAL, renewalForm());
    expect(state.message).toBe(
      "You do not have permission to renew memberships.",
    );
    mockRenewMembership.mockRejectedValue(new MemberNotFoundError());
    state = await renewMembershipAction(RENEWAL_INITIAL, renewalForm());
    expect(state.message).toBe("Member not found.");
  });

  it("connection loss: check-first message, never a blind retry invitation", async () => {
    mockRenewMembership.mockRejectedValue(dbError("P1001"));
    const state = await renewMembershipAction(RENEWAL_INITIAL, renewalForm());
    expect(state.ok).toBe(false);
    expect(state.message).toContain(
      "couldn't confirm whether this membership was renewed",
    );
    expect(state.message).not.toContain("P1001");
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      "/app/org/members/member-1",
    );
  });

  it("pool timeout: states plainly that nothing was renewed", async () => {
    mockRenewMembership.mockRejectedValue(dbError("P2024"));
    const state = await renewMembershipAction(RENEWAL_INITIAL, renewalForm());
    expect(state.message).toContain("was not renewed");
  });

  it("unexpected errors get the generic message without internals", async () => {
    mockRenewMembership.mockRejectedValue(new Error("surprise"));
    const state = await renewMembershipAction(RENEWAL_INITIAL, renewalForm());
    expect(state.message).toBe(
      "Could not renew the membership. Please try again.",
    );
    expect(state.message).not.toContain("surprise");
  });
});
