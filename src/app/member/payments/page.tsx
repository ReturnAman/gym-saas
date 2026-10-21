import Link from "next/link";

import { formatKolkataDateTime } from "@/lib/attendance";
import {
  MEMBERSHIP_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_REVERSAL_REASON_LABELS,
  PAYMENT_STATUS_LABELS,
  PLAN_LABELS,
  formatDate,
  formatInr,
} from "@/lib/members";
import { requireMemberContext } from "@/lib/server/member-session";
import {
  getOwnMembershipSummary,
  listOwnPaymentClaims,
  listOwnPaymentReversals,
  memberClaimScope,
  type PaymentClaimView,
} from "@/lib/server/payment-claims";

import { ClaimForm } from "./claim-form";

/**
 * Member payments page (Payment Claims C2).
 *
 * Everything here is scoped by the verified member session: the claim
 * scope is translated from the session context in exactly one place
 * (memberClaimScope), and both reads take that scope — no value from
 * the request can steer them to another gym or another member. The
 * balance is the staff derivation (fee vs confirmed payments); claims
 * are shown as what they are — reports awaiting gym verification —
 * and are never counted as paid here.
 */

const CLAIM_STATUS_COPY: Record<PaymentClaimView["status"], string> = {
  PENDING: "Awaiting verification — this doesn't count as paid yet.",
  CONFIRMED: "Confirmed by the gym.",
  REJECTED: "Not accepted — please speak to the gym.",
};

function claimLine(claim: PaymentClaimView) {
  const parts = [
    formatInr(claim.claimedAmountPaise),
    PAYMENT_METHOD_LABELS[claim.paymentMethod],
  ];
  if (claim.reference) {
    parts.push(`Ref: ${claim.reference}`);
  }
  return parts.join(" · ");
}

export default async function MemberPaymentsPage() {
  const context = await requireMemberContext();

  if (!context.member) {
    return (
      <main>
        <h1>Your payments</h1>
        <p>
          We couldn&apos;t load your member record. Please see the front
          desk.
        </p>
      </main>
    );
  }

  const scope = memberClaimScope(context);
  const [summary, claims, reversals] = await Promise.all([
    getOwnMembershipSummary(scope),
    listOwnPaymentClaims(scope),
    listOwnPaymentReversals(scope),
  ]);

  return (
    <main>
      <h1>Your payments</h1>
      <p>{context.organization.name}</p>

      <h2>Your membership</h2>
      {summary === null ? (
        <p>
          You don&apos;t have a membership at this gym yet. Please see the
          front desk.
        </p>
      ) : (
        <>
          <dl>
            <dt>Plan</dt>
            <dd>{PLAN_LABELS[summary.plan]}</dd>
            <dt>Membership status</dt>
            <dd>{MEMBERSHIP_STATUS_LABELS[summary.membershipStatus]}</dd>
            <dt>Start date</dt>
            <dd>{formatDate(new Date(summary.startDate))}</dd>
            <dt>Valid until</dt>
            <dd>{formatDate(new Date(summary.expiryDate))}</dd>
            <dt>Membership fee</dt>
            <dd>{formatInr(summary.feePaise)}</dd>
            <dt>Paid so far (confirmed)</dt>
            <dd>{formatInr(summary.paidPaise)}</dd>
            <dt>Outstanding</dt>
            <dd>{formatInr(summary.outstandingPaise)}</dd>
            <dt>Payment status</dt>
            <dd>{PAYMENT_STATUS_LABELS[summary.paymentStatus]}</dd>
          </dl>
          {summary.membershipStatus === "EXPIRED" && (
            <p>
              This membership has expired. Please see the front desk to
              renew.
            </p>
          )}
        </>
      )}

      <h2>Tell the gym you paid</h2>
      <p>
        If you paid the gym directly — for example by UPI or cash — tell
        us here. Your claim counts as paid only after the gym verifies
        it.
      </p>
      {summary === null ? (
        <p>You need a membership before you can tell the gym about a payment.</p>
      ) : (
        <ClaimForm />
      )}

      <h2>Your payment claims</h2>
      {claims.length === 0 ? (
        <p>No payment claims yet.</p>
      ) : (
        <ul>
          {claims.map((claim) => (
            <li key={claim.id}>
              <p>{claimLine(claim)}</p>
              <p>
                Sent {formatKolkataDateTime(claim.submittedAt)} —{" "}
                {CLAIM_STATUS_COPY[claim.status]}
                {claim.status === "CONFIRMED" &&
                  claim.confirmedAmountPaise !== null &&
                  claim.confirmedAmountPaise !== claim.claimedAmountPaise &&
                  ` Confirmed amount: ${formatInr(claim.confirmedAmountPaise)}.`}
              </p>
            </li>
          ))}
        </ul>
      )}

      {reversals.length > 0 && (
        <>
          <h2>Reversals by the gym</h2>
          <p>
            The gym corrected these payments. The amounts are already
            reflected in your Paid so far total above.
          </p>
          <ul>
            {reversals.map((reversal) => (
              <li key={reversal.id}>
                <p>
                  {PAYMENT_REVERSAL_REASON_LABELS[reversal.reason]} —{" "}
                  {formatInr(reversal.amountPaise)}
                </p>
                <p>
                  Reversed {formatKolkataDateTime(reversal.reversedAt)}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}

      <p>
        <Link href="/member">Back to your gym home</Link>
      </p>
    </main>
  );
}
