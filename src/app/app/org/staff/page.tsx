import Link from "next/link";

import { requireEntitledOrganizationContext } from "@/lib/server/subscriptions";
import {
  StaffAuthorizationError,
  getStaffPermissions,
  listOrganizationStaff,
} from "@/lib/server/staff";

import { getStaffDisplayNames } from "./display-names";
import { StaffManager, type StaffRow } from "./staff-manager";
import styles from "./staff.module.css";

/**
 * Staff management for the actor's gym.
 *
 * Requires authentication AND organization membership (via
 * requireEntitledOrganizationContext). The organization is the actor's primary
 * gym — the same server-side resolution every org page uses; there is
 * no gym switcher yet, and the header says so while naming the gym
 * prominently. Viewing is OWNER/ADMIN (the service enforces the same
 * rule); all mutations run through the staff service, which re-checks
 * authorization server-side on every call.
 */
export default async function StaffPage() {
  const { user, membership, organization } =
    await requireEntitledOrganizationContext();
  const permissions = getStaffPermissions(membership.role);

  const header = (
    <header className={styles.header}>
      <h1>{organization.name}</h1>
      <p>Staff management</p>
      <p className={styles.gymNote}>
        You are managing staff for your primary gym. Switching gyms is
        not available yet.
      </p>
    </header>
  );

  if (!permissions.canViewStaff) {
    return (
      <main>
        {header}
        <section className={styles.stateBox} aria-label="Staff unavailable">
          <h2>You don&rsquo;t have permission to view staff</h2>
          <p>
            Only the gym owner and admins can see or manage staff access
            for {organization.name}.
          </p>
          <div className={styles.stateActions}>
            <Link href="/app/org" className={styles.secondaryButton}>
              Back to gym
            </Link>
          </div>
        </section>
      </main>
    );
  }

  let entries;
  try {
    entries = await listOrganizationStaff(user.id);
  } catch (error) {
    if (error instanceof StaffAuthorizationError) {
      return (
        <main>
          {header}
          <section className={styles.stateBox} aria-label="Staff unavailable">
            <h2>You don&rsquo;t have permission to view staff</h2>
            <p>{error.message}</p>
            <div className={styles.stateActions}>
              <Link href="/app/org" className={styles.secondaryButton}>
                Back to gym
              </Link>
            </div>
          </section>
        </main>
      );
    }
    throw error;
  }

  const displayNames = await getStaffDisplayNames(
    entries.map((entry) => entry.userId),
  );
  const addedFormat = new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
  const rows: StaffRow[] = entries.map((entry) => {
    const isSelf = entry.userId === user.id;
    return {
      membershipId: entry.id,
      displayName: displayNames.get(entry.userId) ?? null,
      role: entry.role,
      addedLabel: `Added ${addedFormat.format(entry.createdAt)}`,
      isSelf,
      canManage:
        permissions.canManageStaff &&
        !isSelf &&
        entry.role !== "OWNER" &&
        permissions.manageableRoles.includes(entry.role),
    };
  });

  return (
    <main>
      {header}
      <StaffManager
        organizationName={organization.name}
        rows={rows}
        grantableRoles={[...permissions.grantableRoles]}
        canManageStaff={permissions.canManageStaff}
      />
    </main>
  );
}
