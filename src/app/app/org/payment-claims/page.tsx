import Link from "next/link";

import { requireOrganizationContext } from "@/lib/server/authorization";
import {
  PENDING_CLAIMS_QUEUE_LIMIT,
  PaymentClaimAuthorizationError,
  canVerifyPaymentClaim,
  listPendingClaimsForReview,
  type PendingClaimReviewView,
} from "@/lib/server/payment-claims";

import { ClaimsManager, type ClaimReviewRow } from "./claims-manager";
import styles from "./payment-claims.module.css";

/**
 * Staff payment claim review for the actor's gym.
 *
 * Requires authentication AND organization membership (via
 * requireOrganizationContext). The organization is the actor's primary
 * gym — the same server-side resolution every org page uses; there is
 * no gym switcher yet, and the header says so while naming the gym
 * prominently. Reviewing is OWNER / ADMIN / STAFF (the service
 * enforces the same rule on every read and decision); other roles get
 * a no-access state here, and the service remains the boundary.
 */

function toRow(claim: PendingClaimReviewView): ClaimReviewRow {
  return {
    id: claim.id,
    memberId: claim.memberId,
    memberName: claim.memberName,
    memberPhoneNumber: claim.memberPhoneNumber,
    membershipPlan: claim.membershipPlan,
    membershipFeePaise: claim.membershipFeePaise,
    membershipExpiryDate: claim.membershipExpiryDate,
    claimedAmountPaise: claim.claimedAmountPaise,
    paymentMethod: claim.paymentMethod,
    reference: claim.reference,
    submittedAt: claim.submittedAt,
    paidPaise: claim.paidPaise,
    outstandingPaise: claim.outstandingPaise,
  };
}

export default async function PaymentClaimsPage() {
  const { user, membership, organization } =
    await requireOrganizationContext();

  const header = (
    <header className={styles.header}>
      <h1>{organization.name}</h1>
      <p>Payment claims</p>
      <p className={styles.gymNote}>
        You are reviewing claims for your primary gym. Switching gyms is
        not available yet.
      </p>
    </header>
  );

  const noAccess = (
    <main>
      {header}
      <section className={styles.stateBox} aria-label="Claims unavailable">
        <h2>You don&rsquo;t have permission to review payment claims</h2>
        <p>
          Only the gym owner, admins, and staff can verify member payments
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

  if (!canVerifyPaymentClaim(membership.role)) {
    return noAccess;
  }

  let claims: PendingClaimReviewView[];
  let totalPending: number;
  try {
    const queue = await listPendingClaimsForReview(user.id);
    claims = queue.claims;
    totalPending = queue.totalPending;
  } catch (error) {
    if (error instanceof PaymentClaimAuthorizationError) {
      return noAccess;
    }
    throw error;
  }

  return (
    <main>
      {header}
      {claims.length === 0 ? (
        <section className={styles.stateBox} aria-label="No pending claims">
          <h2>No payments are waiting for verification.</h2>
          <p>
            When a member tells the gym they paid, their claim will appear
            here for verification.
          </p>
        </section>
      ) : (
        <>
          {totalPending > claims.length && (
            <p className={styles.gymNote} role="status">
              {`Showing the oldest ${PENDING_CLAIMS_QUEUE_LIMIT} of ${totalPending} pending claims. Claims are verified oldest first — the rest will appear as you work through the queue.`}
            </p>
          )}
          <ClaimsManager claims={claims.map(toRow)} />
        </>
      )}
    </main>
  );
}
