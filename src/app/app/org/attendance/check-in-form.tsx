"use client";

import { useActionState } from "react";

import {
  INITIAL_ATTENDANCE_FORM_STATE,
  checkInMemberAction,
} from "./actions";
import styles from "./attendance.module.css";

/**
 * Staff check-in form.
 *
 * Two-step when the membership is EXPIRED: the first submission is held
 * by the server (which re-derives the status from the database — the
 * client never decides expiry) and the action returns
 * `requiresExpiredConfirmation`; this form then shows the warning and a
 * distinct "Check in anyway" submission carrying the explicit
 * confirmation flag. Nothing about the expired state is rendered before
 * the server reports it.
 */
export function CheckInForm({
  memberId,
  from,
}: {
  memberId: string;
  from: "member" | "gym";
}) {
  const [state, formAction, isPending] = useActionState(
    checkInMemberAction,
    INITIAL_ATTENDANCE_FORM_STATE,
  );

  if (state.requiresExpiredConfirmation) {
    return (
      <form action={formAction}>
        <input type="hidden" name="memberId" value={memberId} />
        <input type="hidden" name="from" value={from} />
        <input type="hidden" name="confirmExpiredMembership" value="1" />
        <div className={styles.expiredWarning} role="alert">
          <p>
            {state.message} The membership status was rechecked on the
            server. Check in only if the member should be admitted anyway.
          </p>
          <div>
            <button type="submit" disabled={isPending} className={styles.button}>
              {isPending ? "Checking in…" : "Check in anyway"}
            </button>
          </div>
        </div>
      </form>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="from" value={from} />
      {state.message && (
        <p role="alert" className={styles.formError}>
          {state.message}
        </p>
      )}
      <button type="submit" disabled={isPending} className={styles.button}>
        {isPending ? "Checking in…" : "Check in"}
      </button>
    </form>
  );
}
