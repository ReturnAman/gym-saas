"use server";

import { redirect } from "next/navigation";

import {
  classifyDatabaseError,
  mayHaveCommitted,
} from "@/lib/server/db-errors";
import {
  logDatabaseFailure,
  logUnexpectedError,
} from "@/lib/server/logger";
import {
  PlatformAdminAuthorizationError,
  PlatformAdminValidationError,
  extendTrial,
  reactivateOrganization,
  recordSaasPaymentAndActivate,
  requirePlatformAdmin,
  reviewOffer,
  suspendOrganization,
} from "@/lib/server/platform-admin";

/**
 * Platform-admin server actions (trial/subscription slice).
 *
 * Every action re-authenticates the platform administrator server-side
 * (allowlisted Clerk user ID) and resolves the target organization from
 * the submitted form's organizationId — but only after the admin check,
 * and the service layer validates that ID against real rows before any
 * mutation. Failures redirect back to the detail page with a `notice`
 * message; successes redirect with a confirmation notice. Suspension
 * requires an explicit confirmation checkbox.
 *
 * Failure notices come from failureNotice below: curated domain errors
 * surface their message exactly; unexpected failures are logged once,
 * structured, and answered with a safe generic notice — a raw internal
 * error message never reaches the page.
 */

function detailRedirect(organizationId: string, notice: string): never {
  redirect(
    `/platform-admin/orgs/${organizationId}?notice=${encodeURIComponent(notice)}`,
  );
}

function formString(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "");
}

/**
 * Convert a failed admin action into the notice shown on the detail
 * page (the H2/H3 boundary convention, as in the member payment
 * actions). Validation errors — including idempotency conflicts — and
 * authorization errors carry messages written for the administrator
 * and are preserved exactly. A recognized database failure is logged
 * via logDatabaseFailure; anything else via logUnexpectedError —
 * exactly one structured log per failure, and the notice stays free
 * of internal detail.
 *
 * `ambiguousNotice` is passed only by actions that record money: when
 * the connection died around the write, the change may have committed
 * despite the failure, so the notice directs the admin to the
 * persisted state on the detail page instead of inviting a retry.
 */
function failureNotice(
  error: unknown,
  boundary: string,
  genericNotice: string,
  options: { notRecordedNotice: string; ambiguousNotice?: string },
): string {
  if (
    error instanceof PlatformAdminValidationError ||
    error instanceof PlatformAdminAuthorizationError
  ) {
    return error.message;
  }
  if (options.ambiguousNotice !== undefined && mayHaveCommitted(error)) {
    logDatabaseFailure({ boundary, error });
    return options.ambiguousNotice;
  }
  if (classifyDatabaseError(error)) {
    logDatabaseFailure({ boundary, error });
    return options.notRecordedNotice;
  }
  logUnexpectedError({ boundary, error });
  return genericNotice;
}

export async function recordPaymentAction(formData: FormData): Promise<void> {
  const admin = await requirePlatformAdmin();
  const organizationId = formString(formData, "organizationId");
  // The redirect is issued after the try/catch, never inside it:
  // redirect() works by throwing, and a redirect thrown inside the try
  // would be caught here and converted into a failure notice.
  let notice: string;
  try {
    const { state } = await recordSaasPaymentAndActivate(admin, {
      organizationId,
      amount: formString(formData, "amount"),
      receivedAt: formString(formData, "receivedAt"),
      periodStartAt: formString(formData, "periodStartAt"),
      periodEndAt: formString(formData, "periodEndAt"),
      reference: formString(formData, "reference"),
      notes: formString(formData, "notes"),
      // The token is minted once per form render (hidden field on the
      // detail page), so a double submit of the same form replays to the
      // already-recorded payment instead of recording it twice. A
      // missing token is rejected by the service: every recorded
      // payment must carry a key, so no payment is ever stored
      // without deduplication protection.
      idempotencyKey: formString(formData, "idempotencyKey") || undefined,
    });
    notice = `Payment recorded. Resulting subscription state: ${state}.`;
  } catch (error) {
    notice = failureNotice(
      error,
      "action:platformAdmin.recordPayment",
      "Could not record payment.",
      {
        notRecordedNotice:
          "The database didn't respond in time, so this payment was not recorded. Please try again.",
        ambiguousNotice:
          "We couldn't confirm whether this payment was recorded — the database connection was interrupted. Please check the payments listed on this page before recording it again.",
      },
    );
  }
  detailRedirect(organizationId, notice);
}

export async function suspendAction(formData: FormData): Promise<void> {
  const admin = await requirePlatformAdmin();
  const organizationId = formString(formData, "organizationId");
  if (formString(formData, "confirm") !== "on") {
    detailRedirect(organizationId, "Confirm the suspension first.");
  }
  let notice: string;
  try {
    await suspendOrganization(admin, {
      organizationId,
      reason: formString(formData, "reason"),
    });
    notice = "Gym suspended.";
  } catch (error) {
    notice = failureNotice(
      error,
      "action:platformAdmin.suspend",
      "Could not suspend gym.",
      {
        notRecordedNotice:
          "The database didn't respond in time, so this gym was not suspended. Please try again.",
      },
    );
  }
  detailRedirect(organizationId, notice);
}

export async function extendTrialAction(formData: FormData): Promise<void> {
  const admin = await requirePlatformAdmin();
  const organizationId = formString(formData, "organizationId");
  let notice: string;
  try {
    const { trialEndsAt } = await extendTrial(admin, {
      organizationId,
      days: formString(formData, "days"),
      reason: formString(formData, "reason"),
    });
    notice = `Trial extended to ${trialEndsAt.toISOString()}.`;
  } catch (error) {
    notice = failureNotice(
      error,
      "action:platformAdmin.extendTrial",
      "Could not extend trial.",
      {
        notRecordedNotice:
          "The database didn't respond in time, so the trial was not extended. Please try again.",
      },
    );
  }
  detailRedirect(organizationId, notice);
}

export async function reactivateAction(formData: FormData): Promise<void> {
  const admin = await requirePlatformAdmin();
  const organizationId = formString(formData, "organizationId");
  const withPayment = formString(formData, "withPayment") === "on";
  let notice: string;
  try {
    await reactivateOrganization(admin, {
      organizationId,
      reason: formString(formData, "reason"),
      payment: withPayment
        ? {
            organizationId,
            amount: formString(formData, "amount"),
            receivedAt: formString(formData, "receivedAt"),
            periodStartAt: formString(formData, "periodStartAt"),
            periodEndAt: formString(formData, "periodEndAt"),
            reference: formString(formData, "reference"),
            notes: formString(formData, "notes"),
            // Minted once per form render (hidden field on the detail
            // page): a retried reactivation replays instead of
            // recording a second payment. A missing token is rejected
            // by the service.
            idempotencyKey: formString(formData, "idempotencyKey") || undefined,
          }
        : null,
    });
    notice = "Gym reactivated.";
  } catch (error) {
    notice = failureNotice(
      error,
      "action:platformAdmin.reactivate",
      "Could not reactivate gym.",
      {
        notRecordedNotice:
          "The database didn't respond in time, so this gym was not reactivated. Please try again.",
        ambiguousNotice:
          "We couldn't confirm whether this reactivation completed — the database connection was interrupted. Please check the gym's subscription and payments on this page before trying again.",
      },
    );
  }
  detailRedirect(organizationId, notice);
}

export async function reviewOfferAction(formData: FormData): Promise<void> {
  const admin = await requirePlatformAdmin();
  const organizationId = formString(formData, "organizationId");
  const offerId = formString(formData, "offerId");
  const decision = formString(formData, "decision");
  let notice: string;
  try {
    if (decision !== "APPROVED" && decision !== "DECLINED") {
      throw new PlatformAdminValidationError("Choose approve or decline.");
    }
    await reviewOffer(admin, {
      offerId,
      decision,
      discountPercent: formString(formData, "discountPercent"),
      offerExpiresAt: formString(formData, "offerExpiresAt"),
      applicablePeriodStartAt: formString(formData, "applicablePeriodStartAt"),
      applicablePeriodEndAt: formString(formData, "applicablePeriodEndAt"),
      agreedAmount: formString(formData, "agreedAmount"),
      notes: formString(formData, "notes"),
    });
    notice = `Offer ${decision.toLowerCase()}.`;
  } catch (error) {
    notice = failureNotice(
      error,
      "action:platformAdmin.reviewOffer",
      "Could not decide offer.",
      {
        notRecordedNotice:
          "The database didn't respond in time, so this offer decision was not saved. Please try again.",
      },
    );
  }
  detailRedirect(organizationId, notice);
}
