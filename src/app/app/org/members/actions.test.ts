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
  mockRevalidatePath,
  mockRedirect,
} = vi.hoisted(() => ({
  mockRequireCurrentUser: vi.fn(),
  mockRecordPayment: vi.fn(),
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
  class MemberNotFoundError extends Error {}
  return {
    MemberAuthorizationError,
    MemberDuplicateError,
    MemberNotFoundError,
    createMemberWithMembership: vi.fn(),
    updateMember: vi.fn(),
  };
});
vi.mock("@/lib/server/payments", () => {
  class PaymentAuthorizationError extends Error {}
  class PaymentNotFoundError extends Error {}
  class PaymentIdempotencyConflictError extends Error {}
  return {
    PaymentAuthorizationError,
    PaymentIdempotencyConflictError,
    PaymentNotFoundError,
    recordPayment: mockRecordPayment,
  };
});

import { recordPaymentAction } from "@/app/app/org/members/actions";
import { PaymentValidationError } from "@/lib/members";
import {
  PaymentAuthorizationError,
  PaymentIdempotencyConflictError,
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
