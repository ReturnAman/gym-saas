import { hasRole, requireOrganizationContext } from "@/lib/server/authorization";

import { ProfileForm } from "./profile-form";
import styles from "./settings.module.css";

/**
 * Gym profile/settings page (protected).
 *
 * The organization is resolved from the authenticated user's membership —
 * never from client input. Any member may view the profile; only the OWNER
 * may edit it. The edit UI is hidden for other roles, but the server action
 * enforces OWNER access regardless.
 */
export default async function SettingsPage() {
  const { organization, membership } = await requireOrganizationContext();
  const isOwner = hasRole(membership, "OWNER");

  return (
    <main>
      <h1>Gym settings</h1>
      {isOwner ? (
        <ProfileForm
          initial={{
            name: organization.name,
            phone: organization.phone ?? "",
            email: organization.email ?? "",
            address: organization.address ?? "",
          }}
        />
      ) : (
        <>
          <dl className={styles.profile}>
            <div className={styles.row}>
              <dt className={styles.term}>Gym name</dt>
              <dd className={styles.value}>{organization.name}</dd>
            </div>
            <div className={styles.row}>
              <dt className={styles.term}>Phone</dt>
              <dd className={styles.value}>
                {organization.phone ?? <span className={styles.empty}>—</span>}
              </dd>
            </div>
            <div className={styles.row}>
              <dt className={styles.term}>Email</dt>
              <dd className={styles.value}>
                {organization.email ?? <span className={styles.empty}>—</span>}
              </dd>
            </div>
            <div className={styles.row}>
              <dt className={styles.term}>Address</dt>
              <dd className={styles.value}>
                {organization.address ?? <span className={styles.empty}>—</span>}
              </dd>
            </div>
          </dl>
          <p className={styles.notice}>
            Only the organization owner can edit these details.
          </p>
        </>
      )}
    </main>
  );
}
