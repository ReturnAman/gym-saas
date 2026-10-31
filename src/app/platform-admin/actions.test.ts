import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

/**
 * Platform-admin actions — safe failure notices (Phase 12 hardening).
 *
 * Curated domain errors (validation, idempotency conflicts,
 * authorization) surface their messages exactly. Everything else is
 * logged once, structured, at a named action boundary, and answered
 * with a safe notice: a raw internal message (Prisma/driver text can
 * embed query and connection details) never reaches the admin page.
 * For the two money-recording actions, a connection failure around
 * the write is ambiguous — the notice sends the admin to the recorded
 * payments instead of inviting a blind retry.
 */

const {
  mockRequirePlatformAdmin,
  mockRecordPayment,
  mockSuspend,
  mockExtendTrial,
  mockReactivate,
  mockReviewOffer,
  mockRedirect,
} = vi.hoisted(() => ({
  mockRequirePlatformAdmin: vi.fn(),
  mockRecordPayment: vi.fn(),
  mockSuspend: vi.fn(),
  mockExtendTrial: vi.fn(),
  mockReactivate: vi.fn(),
  mockReviewOffer: vi.fn(),
  mockRedirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("@/lib/server/platform-admin", () => {
  class PlatformAdminValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "PlatformAdminValidationError";
    }
  }
  class PlatformAdminAuthorizationError extends Error {
    constructor(message = "Platform administrator access is required.") {
      super(message);
      this.name = "PlatformAdminAuthorizationError";
    }
  }
  return {
    PlatformAdminAuthorizationError,
    PlatformAdminValidationError,
    extendTrial: mockExtendTrial,
    reactivateOrganization: mockReactivate,
    recordSaasPaymentAndActivate: mockRecordPayment,
    requirePlatformAdmin: mockRequirePlatformAdmin,
    reviewOffer: mockReviewOffer,
    suspendOrganization: mockSuspend,
  };
});

import {
  extendTrialAction,
  reactivateAction,
  recordPaymentAction,
  reviewOfferAction,
  suspendAction,
} from "@/app/platform-admin/actions";
import {
  PlatformAdminAuthorizationError,
  PlatformAdminValidationError,
} from "@/lib/server/platform-admin";

class RedirectError extends Error {
  constructor(public url: string) {
    super("NEXT_REDIRECT");
  }
}

/** Run an action and capture the redirect it ends with. */
async function redirectOf(
  action: Promise<void>,
): Promise<{ url: string; notice: string }> {
  try {
    await action;
  } catch (error) {
    if (error instanceof RedirectError) {
      const notice = decodeURIComponent(
        error.url.slice(error.url.indexOf("?notice=") + "?notice=".length),
      );
      return { url: error.url, notice };
    }
    throw error;
  }
  throw new Error("expected the action to redirect");
}

function loggedEvents(): Record<string, string>[] {
  return errorSpy.mock.calls.map((call) => JSON.parse(String(call[0])));
}

function dbError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("db failure", {
    code,
    clientVersion: "7.10.0",
  });
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

function paymentForm(): FormData {
  return form({
    organizationId: "org-1",
    amount: "5000.00",
    receivedAt: "2026-10-30",
    periodStartAt: "2026-10-30",
    periodEndAt: "2026-11-29",
    reference: "",
    notes: "",
    idempotencyKey: "token-1",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  errorSpy.mockClear();
  mockRedirect.mockImplementation((url: string) => {
    throw new RedirectError(url);
  });
  mockRequirePlatformAdmin.mockResolvedValue({
    clerkUserId: "admin-clerk",
    userId: "admin-user",
  });
  mockRecordPayment.mockResolvedValue({ state: "ACTIVE" });
  mockSuspend.mockResolvedValue(undefined);
  mockExtendTrial.mockResolvedValue({
    trialEndsAt: new Date("2026-11-30T00:00:00.000Z"),
  });
  mockReactivate.mockResolvedValue(undefined);
  mockReviewOffer.mockResolvedValue(undefined);
});

describe("recordPaymentAction", () => {
  it("success: redirects with the unchanged confirmation notice", async () => {
    const { url, notice } = await redirectOf(recordPaymentAction(paymentForm()));
    expect(notice).toBe("Payment recorded. Resulting subscription state: ACTIVE.");
    expect(url).toBe(
      `/platform-admin/orgs/org-1?notice=${encodeURIComponent(notice)}`,
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("validation error: message preserved exactly, nothing logged", async () => {
    mockRecordPayment.mockRejectedValue(
      new PlatformAdminValidationError("Amount must be greater than zero."),
    );
    const { notice } = await redirectOf(recordPaymentAction(paymentForm()));
    expect(notice).toBe("Amount must be greater than zero.");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("idempotency conflict: message preserved exactly", async () => {
    mockRecordPayment.mockRejectedValue(
      new PlatformAdminValidationError(
        "This idempotency key was already used with a different payment.",
      ),
    );
    const { notice } = await redirectOf(recordPaymentAction(paymentForm()));
    expect(notice).toBe(
      "This idempotency key was already used with a different payment.",
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("authorization error: curated message preserved", async () => {
    mockRecordPayment.mockRejectedValue(new PlatformAdminAuthorizationError());
    const { notice } = await redirectOf(recordPaymentAction(paymentForm()));
    expect(notice).toBe("Platform administrator access is required.");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("unexpected error: generic notice, internals never shown, logged once", async () => {
    mockRecordPayment.mockRejectedValue(
      new Error(
        'Invalid `db.organizationSubscription.create()` invocation: relation "organization_subscriptions" does not exist',
      ),
    );
    const { notice } = await redirectOf(recordPaymentAction(paymentForm()));
    expect(notice).toBe("Could not record payment.");
    expect(notice).not.toContain("organization_subscriptions");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const event = loggedEvents()[0];
    expect(event?.event).toBe("unexpected_error");
    expect(event?.boundary).toBe("action:platformAdmin.recordPayment");
  });

  it("connection loss: check-first notice, never a blind retry", async () => {
    mockRecordPayment.mockRejectedValue(dbError("P1001"));
    const { notice } = await redirectOf(recordPaymentAction(paymentForm()));
    expect(notice).toContain("couldn't confirm whether this payment was recorded");
    expect(notice).toContain("check the payments listed on this page");
    expect(notice).not.toContain("P1001");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const event = loggedEvents()[0];
    expect(event?.event).toBe("database_unavailable");
    expect(event?.errorKind).toBe("connection");
    expect(event?.boundary).toBe("action:platformAdmin.recordPayment");
  });

  it("pool timeout: definite not-recorded notice", async () => {
    mockRecordPayment.mockRejectedValue(dbError("P2024"));
    const { notice } = await redirectOf(recordPaymentAction(paymentForm()));
    expect(notice).toContain("so this payment was not recorded");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const event = loggedEvents()[0];
    expect(event?.event).toBe("database_unavailable");
    expect(event?.errorKind).toBe("pool-timeout");
  });

  it("non-Error throw: generic notice, logged once", async () => {
    mockRecordPayment.mockRejectedValue("boom");
    const { notice } = await redirectOf(recordPaymentAction(paymentForm()));
    expect(notice).toBe("Could not record payment.");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(loggedEvents()[0]?.event).toBe("unexpected_error");
  });
});

describe("suspendAction", () => {
  function suspendForm(): FormData {
    return form({ organizationId: "org-1", confirm: "on", reason: "abuse" });
  }

  it("success: redirects with the unchanged confirmation notice", async () => {
    const { notice } = await redirectOf(suspendAction(suspendForm()));
    expect(notice).toBe("Gym suspended.");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("without confirmation: asks for confirmation and never calls the service", async () => {
    const { notice } = await redirectOf(
      suspendAction(form({ organizationId: "org-1", reason: "abuse" })),
    );
    expect(notice).toBe("Confirm the suspension first.");
    expect(mockSuspend).not.toHaveBeenCalled();
  });

  it("validation error: message preserved exactly", async () => {
    mockSuspend.mockRejectedValue(
      new PlatformAdminValidationError("A suspension reason is required."),
    );
    const { notice } = await redirectOf(suspendAction(suspendForm()));
    expect(notice).toBe("A suspension reason is required.");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("pool timeout: gym was not suspended notice at the suspend boundary", async () => {
    mockSuspend.mockRejectedValue(dbError("P2024"));
    const { notice } = await redirectOf(suspendAction(suspendForm()));
    expect(notice).toContain("so this gym was not suspended");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(loggedEvents()[0]?.boundary).toBe("action:platformAdmin.suspend");
  });
});

describe("extendTrialAction", () => {
  function extendForm(): FormData {
    return form({ organizationId: "org-1", days: "14", reason: "goodwill" });
  }

  it("success: redirects with the unchanged confirmation notice", async () => {
    const { notice } = await redirectOf(extendTrialAction(extendForm()));
    expect(notice).toBe("Trial extended to 2026-11-30T00:00:00.000Z.");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("unexpected error: generic notice, logged at the extendTrial boundary", async () => {
    mockExtendTrial.mockRejectedValue(new Error("clerk exploded internally"));
    const { notice } = await redirectOf(extendTrialAction(extendForm()));
    expect(notice).toBe("Could not extend trial.");
    expect(notice).not.toContain("clerk exploded");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const event = loggedEvents()[0];
    expect(event?.event).toBe("unexpected_error");
    expect(event?.boundary).toBe("action:platformAdmin.extendTrial");
  });
});

describe("reactivateAction", () => {
  function reactivateForm(): FormData {
    return form({
      organizationId: "org-1",
      reason: "paid up",
      withPayment: "on",
      amount: "5000.00",
      receivedAt: "2026-10-30",
      periodStartAt: "2026-10-30",
      periodEndAt: "2026-11-29",
      reference: "",
      notes: "",
      idempotencyKey: "token-2",
    });
  }

  it("success: redirects with the unchanged confirmation notice", async () => {
    const { notice } = await redirectOf(reactivateAction(reactivateForm()));
    expect(notice).toBe("Gym reactivated.");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("connection loss: check-first notice for the ambiguous reactivation", async () => {
    mockReactivate.mockRejectedValue(dbError("P1001"));
    const { notice } = await redirectOf(reactivateAction(reactivateForm()));
    expect(notice).toContain(
      "couldn't confirm whether this reactivation completed",
    );
    expect(notice).toContain("check the gym's subscription and payments");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const event = loggedEvents()[0];
    expect(event?.event).toBe("database_unavailable");
    expect(event?.errorKind).toBe("connection");
    expect(event?.boundary).toBe("action:platformAdmin.reactivate");
  });

  it("validation error: message preserved exactly", async () => {
    mockReactivate.mockRejectedValue(
      new PlatformAdminValidationError(
        "This idempotency key was already used for another gym.",
      ),
    );
    const { notice } = await redirectOf(reactivateAction(reactivateForm()));
    expect(notice).toBe(
      "This idempotency key was already used for another gym.",
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("reviewOfferAction", () => {
  function reviewForm(): FormData {
    return form({
      organizationId: "org-1",
      offerId: "offer-1",
      decision: "APPROVED",
      discountPercent: "10",
      offerExpiresAt: "2026-11-15",
      applicablePeriodStartAt: "2026-11-01",
      applicablePeriodEndAt: "2026-11-30",
      agreedAmount: "4500.00",
      notes: "",
    });
  }

  it("success: redirects with the unchanged confirmation notice", async () => {
    const { notice } = await redirectOf(reviewOfferAction(reviewForm()));
    expect(notice).toBe("Offer approved.");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("invalid decision: the action's own validation message is preserved", async () => {
    const bad = reviewForm();
    bad.set("decision", "MAYBE");
    const { notice } = await redirectOf(reviewOfferAction(bad));
    expect(notice).toBe("Choose approve or decline.");
    expect(mockReviewOffer).not.toHaveBeenCalled();
  });

  it("unexpected error: generic notice, logged at the reviewOffer boundary", async () => {
    mockReviewOffer.mockRejectedValue(new Error("internal offer detail xyz"));
    const { notice } = await redirectOf(reviewOfferAction(reviewForm()));
    expect(notice).toBe("Could not decide offer.");
    expect(notice).not.toContain("internal offer detail");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(loggedEvents()[0]?.boundary).toBe(
      "action:platformAdmin.reviewOffer",
    );
  });
});

describe("authorization gate", () => {
  it("a non-admin never reaches the services", async () => {
    // requirePlatformAdmin redirects non-admins away (the redirect
    // throws in production); the action must stop there.
    mockRequirePlatformAdmin.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(recordPaymentAction(paymentForm())).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    await expect(
      reviewOfferAction(
        form({ organizationId: "org-1", offerId: "o", decision: "APPROVED" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRecordPayment).not.toHaveBeenCalled();
    expect(mockReviewOffer).not.toHaveBeenCalled();
  });
});
