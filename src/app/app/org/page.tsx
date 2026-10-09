import Link from "next/link";

import { requireOrganizationContext } from "@/lib/server/authorization";

/**
 * The organization's protected area (minimal foundation).
 *
 * Requires authentication AND organization membership. The organization is
 * derived from server-side membership data only — no client-provided
 * organization ID or role is accepted as authoritative.
 */
export default async function OrganizationPage() {
  const { organization, membership } = await requireOrganizationContext();

  return (
    <main>
      <h1>{organization.name}</h1>
      <p>Your role: {membership.role}</p>
      <p>
        <Link href="/app/org/members">Members</Link>
      </p>
      <p>
        <Link href="/app/org/attendance">Attendance</Link>
      </p>
      <p>
        <Link href="/app/org/settings">Gym settings</Link>
      </p>
    </main>
  );
}
