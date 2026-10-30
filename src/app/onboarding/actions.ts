"use server";

import { redirect } from "next/navigation";

import { requireCurrentUser } from "@/lib/server/auth";
import { getVerifiedPhoneNumbersForClerkUser } from "@/lib/server/clerk-verified-phone";
import { createOrganizationWithSubscription } from "@/lib/server/organizations";
import {
  canonicalizePhoneNumbers,
  findMatchingVerifiedPhone,
  parseIndianMobileInput,
} from "@/lib/saas-phone";

/**
 * Owner onboarding submission: the authenticated user creates their
 * first gym. Unauthenticated callers are redirected to sign-in by
 * requireCurrentUser before anything else happens.
 *
 * Trial eligibility is resolved server-side, in this order:
 * 1. The submitted mobile number is parsed STRICTLY
 *    (parseIndianMobileInput): exactly 10 ASCII digits, no country
 *    code, no leading zero, no separators. A malformed value sends
 *    the owner back to onboarding with a clear notice — the gym is
 *    not created, and the input is never truncated or corrected.
 * 2. The owner's verified phone numbers are read from Clerk's Backend
 *    API (never from the browser). A lookup outage aborts creation
 *    with a retryable error — the gym is not created trial-less by
 *    accident, and verification is never bypassed.
 * 3. The entered number is matched against the canonicalized verified
 *    numbers (findMatchingVerifiedPhone). Only the matched number, if
 *    any, is passed to the claim path: a verified number the owner did
 *    not enter cannot grant this gym's trial.
 * 4. createOrganizationWithSubscription claims at most one introductory
 *    trial (per owner identity AND per phone, database-enforced). A
 *    gym whose number does not match a verified number — or whose
 *    owner/phone already consumed a trial — is created in
 *    PENDING_PAYMENT and the owner lands on the subscription screen
 *    with a notice explaining what to do next.
 *
 * On a granted trial the owner lands in their organization's
 * protected area.
 */
export async function createOrganizationAction(
  formData: FormData,
): Promise<void> {
  const user = await requireCurrentUser();

  const submitted = parseIndianMobileInput(formData.get("phone"));
  if (!submitted) {
    redirect(
      `/onboarding?notice=${encodeURIComponent(
        "Enter a valid 10-digit Indian mobile number: digits only, without +91 or a leading 0.",
      )}`,
    );
  }

  const verifiedPhones = user.clerkUserId
    ? canonicalizePhoneNumbers(
        await getVerifiedPhoneNumbersForClerkUser(user.clerkUserId),
      )
    : [];
  const matched = user.clerkUserId
    ? findMatchingVerifiedPhone(submitted, verifiedPhones)
    : null;

  const result = await createOrganizationWithSubscription(
    user.id,
    user.clerkUserId,
    matched ? [matched] : [],
    {
      name: String(formData.get("name") ?? ""),
    },
  );

  if (result.trialGranted) {
    redirect("/app/org");
  }
  redirect(
    `/app/subscription?notice=${encodeURIComponent(
      "Your gym was created, but no free trial started because the mobile number you entered does not match a verified number on your account. Verify this number on your account (or enter your verified number) and contact the Gym SaaS team to arrange activation.",
    )}`,
  );
}
