import { redirect } from "next/navigation";

import { createOrganizationAction } from "./actions";
import { requireCurrentUser } from "@/lib/server/auth";
import { getPrimaryMembership } from "@/lib/server/authorization";
import { MAX_ORGANIZATION_NAME_LENGTH } from "@/lib/server/organizations";

/**
 * First-time owner onboarding. Protected: unauthenticated visitors are sent
 * to sign-in. Users who already belong to an organization never see this
 * page again — they go straight to their organization's area.
 */
export default async function OnboardingPage() {
  const user = await requireCurrentUser();
  const membership = await getPrimaryMembership(user.id);
  if (membership) {
    redirect("/app/org");
  }

  return (
    <main>
      <h1>Create your gym</h1>
      <p>Name your gym to get started. You will be its owner.</p>
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
        <button type="submit">Create gym</button>
      </form>
    </main>
  );
}
