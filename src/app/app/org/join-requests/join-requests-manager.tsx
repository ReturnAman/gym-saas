"use client";

import { useActionState, useState } from "react";

import { formatKolkataDateTime } from "@/lib/attendance";
import {
  MEMBERSHIP_PLANS,
  PLAN_LABELS,
  calculateExpiryDate,
  formatDate,
  formatInr,
  parseDateInput,
  type MembershipPlan,
} from "@/lib/members";

import {
  approveJoinRequestAction,
  rejectJoinRequestAction,
} from "./actions";
import { INITIAL_JOIN_REQUEST_DECISION_STATE } from "./join-requests-action-state";
import styles from "./join-requests.module.css";

/**
 * The decision controls for one pending join request, and the list
 * that renders them.
 *
 * One row of the queue — a structural mirror of the
 * member-join-requests service's MemberJoinRequestView (the service
 * remains the source of that contract; the page maps its result
 * into this shape). The request ID travels only in a hidden form
 * field so the server actions can identify the request; it is never
 * rendered as content, and no client-submitted value steers
 * authorization, scoping, or cache revalidation — the service
 * re-derives all of that.
 */
export interface JoinRequestRow {
  id: string;
  name: string;
  phoneNumber: string;
  requestedPlan: MembershipPlan;
  proposedFeePaise: number;
  proposedStartDate: string;
  submittedAt: string;
}

/** Paise → the plain decimal string a fee input should start with. */
function feeInputValue(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const remainder = paise % 100;
  return remainder === 0
    ? String(rupees)
    : `${rupees}.${String(remainder).padStart(2, "0")}`;
}

function RequestCard({ request }: { request: JoinRequestRow }) {
  const [approveState, approveAction, approvePending] = useActionState(
    approveJoinRequestAction,
    INITIAL_JOIN_REQUEST_DECISION_STATE,
  );
  const [rejectState, rejectAction, rejectPending] = useActionState(
    rejectJoinRequestAction,
    INITIAL_JOIN_REQUEST_DECISION_STATE,
  );
  const [rejectArmed, setRejectArmed] = useState(false);
  // The confirmed terms start from the requester's proposal and are
  // staff-editable; the expiry preview tracks them live.
  const [plan, setPlan] = useState<MembershipPlan>(request.requestedPlan);
  const [startDate, setStartDate] = useState(
    request.proposedStartDate.slice(0, 10),
  );
  const busy = approvePending || rejectPending;

  const parsedStart = parseDateInput(startDate);
  const expiryPreview = parsedStart
    ? formatDate(calculateExpiryDate(parsedStart, plan))
    : null;

  const planFieldId = `approve-plan-${request.id}`;
  const feeFieldId = `approve-fee-${request.id}`;
  const startFieldId = `approve-start-${request.id}`;

  return (
    <li className={styles.row}>
      <div className={styles.rowHeader}>
        <span className={styles.rowName}>{request.name}</span>
        <span>{request.phoneNumber}</span>
      </div>
      <p className={styles.rowMeta}>
        Asked for {PLAN_LABELS[request.requestedPlan]} · Proposed fee{" "}
        {formatInr(request.proposedFeePaise)} · Proposed start{" "}
        {formatDate(new Date(request.proposedStartDate))}
      </p>
      <p className={styles.rowMeta}>
        Requested {formatKolkataDateTime(request.submittedAt)}
      </p>

      <form action={approveAction} className={styles.form}>
        <input type="hidden" name="requestId" value={request.id} />
        <div className={styles.field}>
          <label htmlFor={planFieldId}>Plan</label>
          <select
            id={planFieldId}
            name="plan"
            value={plan}
            onChange={(event) =>
              setPlan(event.target.value as MembershipPlan)
            }
          >
            {MEMBERSHIP_PLANS.map((option) => (
              <option key={option} value={option}>
                {PLAN_LABELS[option]}
              </option>
            ))}
          </select>
          {approveState.errors.plan && (
            <p role="alert" className={styles.fieldError}>
              {approveState.errors.plan}
            </p>
          )}
        </div>
        <div className={styles.field}>
          <label htmlFor={feeFieldId}>Fee (₹)</label>
          <input
            id={feeFieldId}
            name="fee"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={feeInputValue(request.proposedFeePaise)}
          />
          {approveState.errors.fee && (
            <p role="alert" className={styles.fieldError}>
              {approveState.errors.fee}
            </p>
          )}
        </div>
        <div className={styles.field}>
          <label htmlFor={startFieldId}>Start date</label>
          <input
            id={startFieldId}
            name="startDate"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
          {approveState.errors.startDate && (
            <p role="alert" className={styles.fieldError}>
              {approveState.errors.startDate}
            </p>
          )}
        </div>
        <p className={styles.fieldNote}>
          {expiryPreview
            ? `Membership will run until ${expiryPreview} (calculated from the plan and start date).`
            : "Membership end date is calculated from the plan and start date."}
        </p>
        <button type="submit" className={styles.button} disabled={busy}>
          {approvePending ? "Approving…" : "Approve and create membership"}
        </button>
      </form>
      {approveState.message && (
        <p
          role={approveState.ok ? "status" : "alert"}
          className={`${styles.message} ${approveState.ok ? styles.messageOk : styles.messageError}`}
        >
          {approveState.message}
        </p>
      )}

      {rejectArmed ? (
        <div className={styles.confirmBox}>
          <p>
            Reject this request? The person will not become a member,
            and nothing will be created.
          </p>
          <div className={styles.rowActions}>
            <form action={rejectAction}>
              <input type="hidden" name="requestId" value={request.id} />
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
            Reject request
          </button>
        </div>
      )}
    </li>
  );
}

export function JoinRequestsManager({
  requests,
}: {
  requests: JoinRequestRow[];
}) {
  return (
    <ul className={styles.list} aria-label="Pending join requests">
      {requests.map((request) => (
        <RequestCard key={request.id} request={request} />
      ))}
    </ul>
  );
}
