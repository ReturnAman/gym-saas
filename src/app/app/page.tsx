import { redirect } from "next/navigation";

import { requireCurrentUser } from "@/lib/server/auth";
import { getPrimaryMembership } from "@/lib/server/authorization";

// Entry point into the protected application.
//
// Authentication is enforced server-side: requireCurrentUser() redirects
// unauthenticated visitors to /sign-in before anything else happens.
// Authenticated users are routed by membership: first-time users with no
// organization go to onboarding; everyone else goes to their
// organization's protected area.
export default async function AppPage() {
  const user = await requireCurrentUser();
  const membership = await getPrimaryMembership(user.id);
  if (!membership) {
    redirect("/onboarding");
  }
  redirect("/app/org");
}
