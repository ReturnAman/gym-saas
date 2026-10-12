"use server";

import { revalidatePath } from "next/cache";

import { PaymentValidationError } from "@/lib/members";
import { requireCurrentUser } from "@/lib/server/auth";
import {
  PaymentClaimAuthorizationError,
  PaymentClaimConflictError,
  PaymentClaimNotFoundError,
  confirmPaymentClaim,
  rejectPaymentClaim,
} from "@/lib/server/payment-claims";

import type { ClaimDecisionState } from "./payment-claims-action-state";

/**
 * Server actions for the staff payment claim review queue.
 *
 * Authentication comes from requireCurrentUser (redirects to
 * sign-in); organization scope, role authorization (OWNER / ADMIN /
 * STAFF), the decision's transactional safety, and audit events are
 * all enforced inside the payment-claims service. These actions only
 * translate form data into service calls and service outcomes into
 * safe UI state. The only user input read is the claim ID and the
 * optional confirmation amount; no client-submitted value ever
 * steers authorization, scoping, or cache revalidation — after a
 * decision only the two fixed paths below are revalidated. (The
 * member's detail page is server-rendered per request, so it picks
 * up the decision on its next load without a targeted revalidation.)
 */

const CLAIMS_PATH = "/app/org/payment-claims";
const MEMBERS_PATH = "/app/org/members";

function revalidateClaimSurfaces() {
  revalidatePath(CLAIMS_PATH);
  revalidatePath(MEMBERS_PATH);
}

function noLongerAvailable(): ClaimDecisionState {
  return {
    ok: false,
    message: "This claim is no longer available.",
    errors: {},
  };
}

function mapDecisionError(error: unknown): ClaimDecisionState {
  if (error instanceof PaymentValidationError) {
    return {
      ok: false,
      message: error.errors.form ?? null,
      errors: error.errors.amount
        ? { amount: error.errors.amount }
        : {},
    };
  }
  if (error instanceof PaymentClaimConflictError) {
    // Another staff member (or a double submit) already decided this
    // claim. Refresh the queue so the decided claim disappears.
    revalidateClaimSurfaces();
    return {
      ok: false,
      message: "This claim has already been decided.",
      errors: {},
    };
  }
  if (
    error instanceof PaymentClaimAuthorizationError ||
    error instanceof PaymentClaimNotFoundError
  ) {
    return noLongerAvailable();
  }
  // Unknown failures get a generic message — never leak internals.
  return {
    ok: false,
    message: "Something went wrong. Please try again.",
    errors: {},
  };
}

/**
 * Confirm a claim: records a real payment for the amount actually
 * received (defaulting to the claimed amount when the field is left
 * blank) via the payment-claims service — the only code path that
 * turns a claim into a confirmed payment.
 */
export async function confirmClaimAction(
  _prevState: ClaimDecisionState,
  formData: FormData,
): Promise<ClaimDecisionState> {
  const user = await requireCurrentUser();
  const claimId = String(formData.get("claimId") ?? "");
  const amount = String(formData.get("amount") ?? "").trim();
  if (!claimId) {
    return noLongerAvailable();
  }
  try {
    await confirmPaymentClaim(
      user.id,
      claimId,
      amount === "" ? undefined : { amount },
    );
  } catch (error) {
    return mapDecisionError(error);
  }
  revalidateClaimSurfaces();
  return { ok: true, message: "Payment confirmed and recorded.", errors: {} };
}

/** Reject a claim: no payment is created; the service audits it. */
export async function rejectClaimAction(
  _prevState: ClaimDecisionState,
  formData: FormData,
): Promise<ClaimDecisionState> {
  const user = await requireCurrentUser();
  const claimId = String(formData.get("claimId") ?? "");
  if (!claimId) {
    return noLongerAvailable();
  }
  try {
    await rejectPaymentClaim(user.id, claimId);
  } catch (error) {
    return mapDecisionError(error);
  }
  revalidateClaimSurfaces();
  return { ok: true, message: "Claim rejected.", errors: {} };
}
