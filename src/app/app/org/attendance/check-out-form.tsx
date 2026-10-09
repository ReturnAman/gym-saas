"use client";

import { useActionState } from "react";

import {
  INITIAL_ATTENDANCE_FORM_STATE,
  checkOutAllOpenSessionsAction,
  checkOutMemberAction,
} from "./actions";
import styles from "./attendance.module.css";

/**
 * Check-out form for one open session. The session ID comes from a hidden
 * field but is never trusted: the service re-verifies it against the
 * caller's organization server-side. Check-out is idempotent — a double
 * submission returns to the page without duplicating the audit event.
 */
export function CheckOutForm({
  sessionId,
  memberId,
  from,
  label = "Check out",
}: {
  sessionId: string;
  memberId?: string;
  from: "member" | "gym";
  label?: string;
}) {
  const [state, formAction, isPending] = useActionState(
    checkOutMemberAction,
    INITIAL_ATTENDANCE_FORM_STATE,
  );

  return (
    <form action={formAction} className={styles.inlineForm}>
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="memberId" value={memberId ?? ""} />
      <input type="hidden" name="from" value={from} />
      <button type="submit" disabled={isPending} className={styles.smallButton}>
        {isPending ? "Checking out…" : label}
      </button>
      {state.message && (
        <span role="alert" className={styles.formError}>
          {state.message}
        </span>
      )}
    </form>
  );
}

/**
 * End-of-day form: checks out everyone still in the gym. Only rendered
 * when at least one session is open; each session that actually closes
 * is audited server-side.
 */
export function CheckOutAllForm() {
  const [state, formAction, isPending] = useActionState(
    checkOutAllOpenSessionsAction,
    INITIAL_ATTENDANCE_FORM_STATE,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="from" value="gym" />
      {state.message && (
        <p role="alert" className={styles.formError}>
          {state.message}
        </p>
      )}
      <button type="submit" disabled={isPending} className={styles.secondaryButton}>
        {isPending ? "Checking out…" : "Check out all — end of day"}
      </button>
    </form>
  );
}
