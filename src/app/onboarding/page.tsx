import { redirect } from "next/navigation";

import { createOrganizationAction } from "./actions";
import { requireCurrentUser } from "@/lib/server/auth";
import { getPrimaryMembership } from "@/lib/server/authorization";
import { MAX_ORGANIZATION_NAME_LENGTH } from "@/lib/server/organizations";

/**
 * First-time owner onboarding. Protected: unauthenticated visitors are sent
 * to sign-in. Users who already belong to an organization never see this
 * page again — they go straight to their organization's area.
 *
 * The mobile field is India-only (V1 product decision): the owner types
 * exactly 10 digits, with "+91" displayed separately and never typed.
 * The pattern attribute is a usability hint only — the server action
 * re-validates strictly (parseIndianMobileInput) and the trial is
 * granted only when the entered number matches a number Clerk reports
 * as verified on this account. No maxLength is set on purpose: an
 * overlong value must reach validation and be rejected visibly, never
 * silently truncated to 10 digits by the browser.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const user = await requireCurrentUser();
  const membership = await getPrimaryMembership(user.id);
  if (membership) {
    redirect("/app/org");
  }
  const params = await searchParams;

  return (
    <main>
      <h1>Create your gym</h1>
      <p>Name your gym to get started. You will be its owner.</p>
      {params.notice && <p role="alert">{params.notice}</p>}
      <form action={createOrganizationAction}>
        <label htmlFor="name">Gym name</label>
        <input
          id="name"
          name="name"
          type="text"
          required
          maxLength={MAX_ORGANIZATION_NAME_LENGTH}
          autoComplete="organization"
        />
        <label htmlFor="phone">Mobile number (India)</label>
        <p id="phone-hint">
          Enter your 10-digit Indian mobile number, without the +91
          country code. It must match a verified number on your account
          to start the free trial.
        </p>
        <div>
          <span aria-hidden="true">+91</span>
          <input
            id="phone"
            name="phone"
            type="tel"
            required
            inputMode="numeric"
            autoComplete="tel-national"
            pattern="[0-9]{10}"
            title="Enter exactly 10 digits, without +91 or a leading 0"
            aria-describedby="phone-hint"
          />
        </div>
        <button type="submit">Create gym</button>
      </form>
    </main>
  );
}
