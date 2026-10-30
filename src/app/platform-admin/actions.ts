"use server";

import { redirect } from "next/navigation";

import {
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
 */

function detailRedirect(organizationId: string, notice: string): never {
  redirect(
    `/platform-admin/orgs/${organizationId}?notice=${encodeURIComponent(notice)}`,
  );
}

function formString(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "");
}

export async function recordPaymentAction(formData: FormData): Promise<void> {
  const admin = await requirePlatformAdmin();
  const organizationId = formString(formData, "organizationId");
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
    detailRedirect(
      organizationId,
      `Payment recorded. Resulting subscription state: ${state}.`,
    );
  } catch (error) {
    detailRedirect(
      organizationId,
      error instanceof Error ? error.message : "Could not record payment.",
    );
  }
}

export async function suspendAction(formData: FormData): Promise<void> {
  const admin = await requirePlatformAdmin();
  const organizationId = formString(formData, "organizationId");
  if (formString(formData, "confirm") !== "on") {
    detailRedirect(organizationId, "Confirm the suspension first.");
  }
  try {
    await suspendOrganization(admin, {
      organizationId,
      reason: formString(formData, "reason"),
    });
    detailRedirect(organizationId, "Gym suspended.");
  } catch (error) {
    detailRedirect(
      organizationId,
      error instanceof Error ? error.message : "Could not suspend gym.",
    );
  }
}

export async function extendTrialAction(formData: FormData): Promise<void> {
  const admin = await requirePlatformAdmin();
  const organizationId = formString(formData, "organizationId");
  try {
    const { trialEndsAt } = await extendTrial(admin, {
      organizationId,
      days: formString(formData, "days"),
      reason: formString(formData, "reason"),
    });
    detailRedirect(
      organizationId,
      `Trial extended to ${trialEndsAt.toISOString()}.`,
    );
  } catch (error) {
    detailRedirect(
      organizationId,
      error instanceof Error ? error.message : "Could not extend trial.",
    );
  }
}

export async function reactivateAction(formData: FormData): Promise<void> {
  const admin = await requirePlatformAdmin();
  const organizationId = formString(formData, "organizationId");
  const withPayment = formString(formData, "withPayment") === "on";
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
    detailRedirect(organizationId, "Gym reactivated.");
  } catch (error) {
    detailRedirect(
      organizationId,
      error instanceof Error ? error.message : "Could not reactivate gym.",
    );
  }
}

export async function reviewOfferAction(formData: FormData): Promise<void> {
  const admin = await requirePlatformAdmin();
  const organizationId = formString(formData, "organizationId");
  const offerId = formString(formData, "offerId");
  const decision = formString(formData, "decision");
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
    detailRedirect(organizationId, `Offer ${decision.toLowerCase()}.`);
  } catch (error) {
    detailRedirect(
      organizationId,
      error instanceof Error ? error.message : "Could not decide offer.",
    );
  }
}
