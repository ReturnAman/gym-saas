"use client";

import { useActionState, useState } from "react";

import { newIdempotencyToken } from "@/lib/idempotency";
import {
  MEMBERSHIP_PLANS,
  PLAN_LABELS,
  type MembershipPlan,
} from "@/lib/members";

import {
  INITIAL_RENEWAL_FORM_STATE,
  renewMembershipAction,
} from "../actions";
import styles from "../members.module.css";

/** Exact rupee string for a fee input default — integer math only. */
function feeInputValue(feePaise: number): string {
  const rupees = Math.floor(feePaise / 100);
  const paise = feePaise % 100;
  return paise === 0
    ? String(rupees)
    : `${rupees}.${String(paise).padStart(2, "0")}`;
}

/**
 * Renew-membership form (member detail page).
 *
 * Plan and fee default from the current membership and stay editable;
 * the expiry date is prefilled with a suggested date the staff member
 * confirms or changes — the server validates the submitted date and
 * derives the new period's start itself. One idempotency token per
 * form instance (H4) makes a double-click or a retry after a lost
 * response resolve to the original renewal instead of creating a
 * second period; a successful renewal navigates back to this page,
 * so the next renewal gets a fresh form and a fresh token.
 */
export function RenewalForm({
  memberId,
  defaultPlan,
  defaultFeePaise,
  newPeriodStartLabel,
  suggestedExpiryDate,
  pendingClaimsCount,
}: {
  memberId: string;
  defaultPlan: MembershipPlan;
  defaultFeePaise: number;
  /** Display label for the server-derived start of the new period. */
  newPeriodStartLabel: string;
  /** Suggested expiry (yyyy-mm-dd), editable by staff. */
  suggestedExpiryDate: string;
  pendingClaimsCount: number;
}) {
  const [state, formAction, isPending] = useActionState(
    renewMembershipAction,
    INITIAL_RENEWAL_FORM_STATE,
  );
  const [idempotencyToken] = useState(() => newIdempotencyToken());

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="memberId" value={memberId} />
      <input
        type="hidden"
        name="idempotencyToken"
        value={idempotencyToken}
      />

      {state.message && (
        <p role="alert" className={styles.formError}>
          {state.message}
        </p>
      )}

      <p className={styles.hint}>
        The new period starts {newPeriodStartLabel}. The current period
        and its payments stay as they are.
      </p>
      {pendingClaimsCount > 0 && (
        <p className={styles.hint}>
          {pendingClaimsCount} payment{" "}
          {pendingClaimsCount === 1 ? "claim is" : "claims are"} still
          awaiting verification for the current period. Renewing does not
          move them — they stay with the current period.
        </p>
      )}

      <div className={styles.field}>
        <label htmlFor="renewal-plan" className={styles.label}>
          Plan
        </label>
        <select
          id="renewal-plan"
          name="plan"
          required
          defaultValue={defaultPlan}
          className={styles.select}
          aria-invalid={state.errors.plan ? true : undefined}
          aria-describedby={state.errors.plan ? "renewal-plan-error" : undefined}
        >
          {MEMBERSHIP_PLANS.map((plan) => (
            <option key={plan} value={plan}>
              {PLAN_LABELS[plan]}
            </option>
          ))}
        </select>
        {state.errors.plan && (
          <p id="renewal-plan-error" role="alert" className={styles.error}>
            {state.errors.plan}
          </p>
        )}
      </div>

      <div className={styles.field}>
        <label htmlFor="renewal-fee" className={styles.label}>
          Fee for the new period (₹)
        </label>
        <input
          id="renewal-fee"
          name="fee"
          type="text"
          required
          inputMode="decimal"
          defaultValue={feeInputValue(defaultFeePaise)}
          placeholder="6000 or 6000.50"
          className={styles.input}
          aria-invalid={state.errors.fee ? true : undefined}
          aria-describedby={state.errors.fee ? "renewal-fee-error" : undefined}
        />
        {state.errors.fee && (
          <p id="renewal-fee-error" role="alert" className={styles.error}>
            {state.errors.fee}
          </p>
        )}
      </div>

      <div className={styles.field}>
        <label htmlFor="renewal-expiry" className={styles.label}>
          Expiry date
        </label>
        <input
          id="renewal-expiry"
          name="expiryDate"
          type="date"
          required
          defaultValue={suggestedExpiryDate}
          className={styles.input}
          aria-invalid={state.errors.expiryDate ? true : undefined}
          aria-describedby={
            state.errors.expiryDate ? "renewal-expiry-error" : undefined
          }
        />
        {state.errors.expiryDate && (
          <p id="renewal-expiry-error" role="alert" className={styles.error}>
            {state.errors.expiryDate}
          </p>
        )}
      </div>

      <div className={styles.actions}>
        <button type="submit" disabled={isPending} className={styles.button}>
          {isPending ? "Renewing…" : "Renew membership"}
        </button>
      </div>
    </form>
  );
}
