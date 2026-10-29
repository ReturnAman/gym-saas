import { describe, expect, it } from "vitest";

import {
  PlatformAdminValidationError,
  reactivateOrganization,
  recordSaasPaymentAndActivate,
  type PlatformAdminContext,
} from "../platform-admin";

/**
 * SaaS payment idempotency, mandatory-key rule (Phase 3 fix 3).
 *
 * A payment recorded without an idempotency key could never be
 * deduplicated — PostgreSQL treats NULLs as distinct in the unique
 * index — so a retried submission would silently record a second
 * payment. The service therefore rejects a missing or empty token
 * before touching the database, instead of falling back to an
 * unprotected path. These cases throw during validation, so no
 * database mock is needed: a rejection here proves nothing was
 * recorded, because the transaction is never reached.
 */
const admin: PlatformAdminContext = {
  clerkUserId: "user_admin",
  userId: "admin-user-id",
};

function paymentInput(idempotencyKey: unknown) {
  return {
    organizationId: "org-1",
    amount: "100.00",
    receivedAt: "2026-10-20",
    periodStartAt: "2026-10-20",
    periodEndAt: "2026-11-19",
    idempotencyKey,
  };
}

describe("recordSaasPaymentAndActivate idempotency key requirement", () => {
  it("rejects a missing idempotency key", async () => {
    await expect(
      recordSaasPaymentAndActivate(admin, paymentInput(undefined)),
    ).rejects.toThrow(PlatformAdminValidationError);
    await expect(
      recordSaasPaymentAndActivate(admin, paymentInput(undefined)),
    ).rejects.toThrow("Idempotency key is required");
  });

  it("rejects an empty idempotency key", async () => {
    await expect(
      recordSaasPaymentAndActivate(admin, paymentInput("")),
    ).rejects.toThrow("Idempotency key is required");
  });

  it("rejects a malformed idempotency key", async () => {
    await expect(
      recordSaasPaymentAndActivate(admin, paymentInput("short")),
    ).rejects.toThrow("Invalid idempotency key");
  });
});

describe("reactivateOrganization idempotency key requirement", () => {
  function reactivationInput(idempotencyKey: unknown) {
    return {
      organizationId: "org-1",
      reason: "test reactivation",
      payment: {
        organizationId: "org-1",
        amount: "100.00",
        receivedAt: "2026-10-20",
        periodStartAt: "2026-10-20",
        periodEndAt: "2026-11-19",
        idempotencyKey,
      },
    };
  }

  it("rejects a missing idempotency key", async () => {
    await expect(
      reactivateOrganization(admin, reactivationInput(undefined)),
    ).rejects.toThrow(PlatformAdminValidationError);
    await expect(
      reactivateOrganization(admin, reactivationInput(undefined)),
    ).rejects.toThrow("Idempotency key is required");
  });

  it("rejects an empty idempotency key", async () => {
    await expect(
      reactivateOrganization(admin, reactivationInput("")),
    ).rejects.toThrow("Idempotency key is required");
  });

  it("rejects a malformed idempotency key", async () => {
    await expect(
      reactivateOrganization(admin, reactivationInput("short")),
    ).rejects.toThrow("Invalid idempotency key");
  });
});
