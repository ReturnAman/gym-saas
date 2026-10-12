"use client";

import { useActionState, useState } from "react";

import { formatKolkataDateTime } from "@/lib/attendance";
import {
  PAYMENT_METHOD_LABELS,
  PLAN_LABELS,
  formatInr,
  type MembershipPlan,
  type PaymentMethod,
} from "@/lib/members";

import { confirmClaimAction, rejectClaimAction } from "./actions";
import { INITIAL_CLAIM_DECISION_STATE } from "./payment-claims-action-state";
import styles from "./payment-claims.module.css";

/**
 * One row of the staff claim-review queue — a structural mirror of
 * the payment-claims service's PendingClaimReviewView (the service
 * remains the source of that contract; the page maps its result into
 * this shape). The claim ID travels only in a hidden form field so
 * the server actions can identify the claim; it is never rendered
 * as content, and no client-submitted value steers authorization,
 * scoping, or cache revalidation.
 */
export interface ClaimReviewRow {
  id: string;
  memberId: string;
  memberName: string;
  memberPhoneNumber: string;
  membershipPlan: MembershipPlan;
  membershipFeePaise: number;
  membershipExpiryDate: string;
  claimedAmountPaise: number;
  paymentMethod: PaymentMethod;
  reference: string | null;
  submittedAt: string;
  paidPaise: number;
  outstandingPaise: number;
}

/** Paise → the plain decimal string an amount input should start with. */
function amountInputValue(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const remainder = paise % 100;
  return remainder === 0
    ? String(rupees)
    : `${rupees}.${String(remainder).padStart(2, "0")}`;
}

function ClaimCard({ claim }: { claim: ClaimReviewRow }) {
  const [confirmState, confirmAction, confirmPending] = useActionState(
    confirmClaimAction,
    INITIAL_CLAIM_DECISION_STATE,
  );
  const [rejectState, rejectAction, rejectPending] = useActionState(
    rejectClaimAction,
    INITIAL_CLAIM_DECISION_STATE,
  );
  const [rejectArmed, setRejectArmed] = useState(false);
  const busy = confirmPending || rejectPending;
  const amountFieldId = `confirm-amount-${claim.id}`;

  return (
    <li className={styles.row}>
      <div className={styles.rowHeader}>
        <span className={styles.rowName}>{claim.memberName}</span>
        <span>{formatInr(claim.claimedAmountPaise)}</span>
      </div>
      <p className={styles.rowMeta}>
        {claim.memberPhoneNumber} · {PLAN_LABELS[claim.membershipPlan]} ·{" "}
        {PAYMENT_METHOD_LABELS[claim.paymentMethod]}
        {claim.reference ? ` · Ref: ${claim.reference}` : ""}
      </p>
      <p className={styles.rowMeta}>
        Claimed {formatKolkataDateTime(claim.submittedAt)}
      </p>
      <p className={styles.context}>
        Membership fee {formatInr(claim.membershipFeePaise)} · Paid so far{" "}
        {formatInr(claim.paidPaise)} · Outstanding{" "}
        {formatInr(claim.outstandingPaise)}
      </p>

      <form action={confirmAction} className={styles.form}>
        <input type="hidden" name="claimId" value={claim.id} />
        <div className={styles.field}>
          <label htmlFor={amountFieldId}>Amount actually received (₹)</label>
          <input
            id={amountFieldId}
            name="amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={amountInputValue(claim.claimedAmountPaise)}
          />
          <p className={styles.fieldNote}>
            This is the amount recorded as paid when you confirm.
          </p>
          {confirmState.errors.amount && (
            <p role="alert" className={styles.fieldError}>
              {confirmState.errors.amount}
            </p>
          )}
        </div>
        <button type="submit" className={styles.button} disabled={busy}>
          {confirmPending ? "Confirming…" : "Confirm payment"}
        </button>
      </form>
      {confirmState.message && (
        <p
          role={confirmState.ok ? "status" : "alert"}
          className={`${styles.message} ${confirmState.ok ? styles.messageOk : styles.messageError}`}
        >
          {confirmState.message}
        </p>
      )}

      {rejectArmed ? (
        <div className={styles.confirmBox}>
          <p>
            Reject this claim? The member will see that it was not
            accepted. No payment will be recorded.
          </p>
          <div className={styles.rowActions}>
            <form action={rejectAction}>
              <input type="hidden" name="claimId" value={claim.id} />
              <button
                type="submit"
                className={styles.dangerButton}
                disabled={busy}
              >
                {rejectPending ? "Rejecting…" : "Confirm rejection"}
              </button>
            </form>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => setRejectArmed(false)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
          {rejectState.message && (
            <p
              role={rejectState.ok ? "status" : "alert"}
              className={`${styles.message} ${rejectState.ok ? styles.messageOk : styles.messageError}`}
            >
              {rejectState.message}
            </p>
          )}
        </div>
      ) : (
        <div className={styles.rowActions}>
          <button
            type="button"
            className={styles.dangerButton}
            onClick={() => setRejectArmed(true)}
            disabled={busy}
          >
            Reject claim
          </button>
        </div>
      )}
    </li>
  );
}

export function ClaimsManager({ claims }: { claims: ClaimReviewRow[] }) {
  return (
    <ul className={styles.list} aria-label="Payments waiting for verification">
      {claims.map((claim) => (
        <ClaimCard key={claim.id} claim={claim} />
      ))}
    </ul>
  );
}
