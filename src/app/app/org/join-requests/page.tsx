import Link from "next/link";

import { requireOrganizationContext } from "@/lib/server/authorization";
import {
  MemberJoinRequestAuthorizationError,
  canViewJoinRequests,
  listPendingJoinRequests,
  type MemberJoinRequestView,
} from "@/lib/server/member-join-requests";

import {
  JoinRequestsManager,
  type JoinRequestRow,
} from "./join-requests-manager";
import styles from "./join-requests.module.css";

/**
 * Pending members — the join-request queue for the actor's gym.
 *
 * Requires authentication AND organization membership (via
 * requireOrganizationContext). The organization is the actor's primary
 * gym — the same server-side resolution every org page uses. Viewing
 * is OWNER / ADMIN / STAFF (the service enforces the same rule on the
 * read and on every decision); other roles get a no-access state
 * here, and the service remains the boundary.
 *
 * Staff decide each request here (Slice 2): approve it — confirming
 * the plan, fee, and start date, which creates the member and their
 * first membership — or reject it. Names are shown as the requester
 * submitted them; plan, fee, and start date start as their proposals
 * and become membership terms only when staff confirm them.
 */

function toRow(request: MemberJoinRequestView): JoinRequestRow {
  return {
    id: request.id,
    name: request.name,
    phoneNumber: request.phoneNumber,
    requestedPlan: request.requestedPlan,
    proposedFeePaise: request.proposedFeePaise,
    proposedStartDate: request.proposedStartDate,
    submittedAt: request.submittedAt,
  };
}
export default async function JoinRequestsPage() {
  const { user, membership, organization } =
    await requireOrganizationContext();

  const header = (
    <header className={styles.header}>
      <h1>{organization.name}</h1>
      <p>Pending members</p>
      <p className={styles.gymNote}>
        You are viewing join requests for your primary gym. Switching
        gyms is not available yet.
      </p>
    </header>
  );

  const noAccess = (
    <main>
      {header}
      <section className={styles.stateBox} aria-label="Queue unavailable">
        <h2>You don&rsquo;t have permission to view join requests</h2>
        <p>
          Only the gym owner, admins, and staff can see who has asked to
          join {organization.name}.
        </p>
        <div className={styles.stateActions}>
          <Link href="/app/org" className={styles.secondaryButton}>
            Back to gym
          </Link>
        </div>
      </section>
    </main>
  );

  if (!canViewJoinRequests(membership.role)) {
    return noAccess;
  }

  let requests: MemberJoinRequestView[];
  let totalPending: number;
  try {
    ({ requests, totalPending } = await listPendingJoinRequests(user.id));
  } catch (error) {
    if (error instanceof MemberJoinRequestAuthorizationError) {
      return noAccess;
    }
    throw error;
  }

  return (
    <main>
      {header}
      {requests.length === 0 ? (
        <section className={styles.stateBox} aria-label="No pending requests">
          <h2>No pending requests</h2>
          <p>
            When someone asks to join this gym from its invitation link,
            their request will appear here.
          </p>
        </section>
      ) : (
        <>
          {totalPending > requests.length && (
            <p className={styles.capNote}>
              Showing the first {requests.length} of {totalPending}{" "}
              pending requests.
            </p>
          )}
          <JoinRequestsManager requests={requests.map(toRow)} />
        </>
      )}
    </main>
  );
}
