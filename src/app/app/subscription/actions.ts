"use server";

import { redirect } from "next/navigation";

import { requireCurrentUser } from "@/lib/server/auth";
import { getPrimaryMembership, hasRole } from "@/lib/server/authorization";
import {
  acceptSaasOffer,
  dismissOfferPrompt,
  requestSaasOffer,
} from "@/lib/server/platform-admin";

/**
 * Owner subscription actions (trial/subscription slice).
 *
 * Every action resolves the organization from the caller's own primary
 * membership — no organization ID is ever accepted from the form — and
 * offer requests require the OWNER role (a commercial decision for the
 * gym's owner, not for staff). Failures redirect back with a `notice`
 * message instead of a raw error page; the page renders the notice as
 * plain text.
 */

function noticeRedirect(message: string): never {
  redirect(`/app/subscription?notice=${encodeURIComponent(message)}`);
}

export async function requestOfferAction(): Promise<void> {
  const user = await requireCurrentUser();
  const membership = await getPrimaryMembership(user.id);
  if (!membership) {
    redirect("/onboarding");
  }
  if (!hasRole(membership, "OWNER")) {
    noticeRedirect("Only the gym owner can request an offer.");
  }
  try {
    await requestSaasOffer(membership.organizationId, user.id);
  } catch (error) {
    noticeRedirect(
      error instanceof Error
        ? error.message
        : "Could not submit the offer request. Please try again.",
    );
  }
  redirect("/app/subscription");
}

export async function dismissOfferPromptAction(): Promise<void> {
  const user = await requireCurrentUser();
  const membership = await getPrimaryMembership(user.id);
  if (!membership) {
    redirect("/onboarding");
  }
  if (!hasRole(membership, "OWNER")) {
    noticeRedirect("Only the gym owner can dismiss the offer prompt.");
  }
  await dismissOfferPrompt(membership.organizationId);
  redirect("/app/org");
}

export async function acceptOfferAction(formData: FormData): Promise<void> {
  const user = await requireCurrentUser();
  const membership = await getPrimaryMembership(user.id);
  if (!membership) {
    redirect("/onboarding");
  }
  if (!hasRole(membership, "OWNER")) {
    noticeRedirect("Only the gym owner can accept an offer.");
  }
  const offerId = String(formData.get("offerId") ?? "");
  if (!offerId) {
    noticeRedirect("Offer not found.");
  }
  try {
    await acceptSaasOffer(membership.organizationId, user.id, offerId);
  } catch (error) {
    noticeRedirect(
      error instanceof Error
        ? error.message
        : "Could not accept the offer. Please try again.",
    );
  }
  redirect("/app/subscription");
}
