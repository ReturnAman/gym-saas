"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import {
  INITIAL_MEMBER_FORM_STATE,
  createMemberAction,
} from "./actions";
import {
  MEMBERSHIP_PLANS,
  PLAN_LABELS,
  calculateExpiryDate,
  formatDate,
  formatInr,
  isMembershipPlan,
  parseDateInput,
  validateFee,
  type MembershipPlan,
} from "@/lib/members";
import styles from "./members.module.css";

function toPaiseOrNull(fee: string): number | null {
  try {
    return validateFee(fee);
  } catch {
    return null;
  }
}

/**
 * Add Member form (manual entry).
 *
 * The membership summary updates live as plan, fee, or start date change,
 * using the same pure domain functions the server validates with — the
 * server remains authoritative on submit. The start date never defaults to
 * today; the user must choose it explicitly.
 *
 * When the server reports existing members with the same phone number, the
 * form holds creation back and surfaces the conflict: the user decides
 * whether to create anyway or go back.
 */
export function MemberForm() {
  const [state, formAction, isPending] = useActionState(
    createMemberAction,
    INITIAL_MEMBER_FORM_STATE,
  );

  const [plan, setPlan] = useState("");
  const [fee, setFee] = useState("");
  const [startDate, setStartDate] = useState("");

  const validPlan: MembershipPlan | null = isMembershipPlan(plan) ? plan : null;
  const parsedStartDate = parseDateInput(startDate);
  const feePaise = fee.trim() === "" ? null : toPaiseOrNull(fee);
  const expiryDate =
    validPlan && parsedStartDate
      ? calculateExpiryDate(parsedStartDate, validPlan)
      : null;

  const showSummary = validPlan !== null || feePaise !== null || parsedStartDate !== null;

  return (
    <form action={formAction} className={styles.form}>
      {state.message && (
        <p role="alert" className={styles.formError}>
          {state.message}
        </p>
      )}

      {state.duplicates.length > 0 && (
        <div className={styles.duplicateWarning} role="alert">
          <h2>Phone number already in use</h2>
          <p>
            These members already use this phone number. Creating this member
            will keep both records — nothing will be merged.
          </p>
          <ul className={styles.duplicateList}>
            {state.duplicates.map((duplicate) => (
              <li key={duplicate.id}>
                {duplicate.name} — {duplicate.phoneNumber}
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <button
              type="submit"
              name="allowDuplicate"
              value="true"
              disabled={isPending}
              className={styles.button}
            >
              {isPending ? "Adding…" : "Create anyway"}
            </button>
            <Link href="/app/org/members" className={styles.secondaryButton}>
              Go back
            </Link>
          </div>
        </div>
      )}

      <div className={styles.field}>
        <label htmlFor="name" className={styles.label}>
          Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          maxLength={120}
          autoComplete="name"
          className={styles.input}
          aria-invalid={state.errors.name ? true : undefined}
          aria-describedby={state.errors.name ? "name-error" : undefined}
        />
        {state.errors.name && (
          <p id="name-error" role="alert" className={styles.error}>
            {state.errors.name}
          </p>
        )}
      </div>

      <div className={styles.field}>
        <label htmlFor="phoneNumber" className={styles.label}>
          Phone number
        </label>
        <input
          id="phoneNumber"
          name="phoneNumber"
          type="tel"
          required
          inputMode="numeric"
          maxLength={10}
          autoComplete="tel"
          className={styles.input}
          aria-invalid={state.errors.phoneNumber ? true : undefined}
          aria-describedby={
            state.errors.phoneNumber ? "phoneNumber-error phoneNumber-hint" : "phoneNumber-hint"
          }
        />
        <p id="phoneNumber-hint" className={styles.hint}>
          Exactly 10 digits, no country code.
        </p>
        {state.errors.phoneNumber && (
          <p id="phoneNumber-error" role="alert" className={styles.error}>
            {state.errors.phoneNumber}
          </p>
        )}
      </div>

      <div className={styles.field}>
        <label htmlFor="fee" className={styles.label}>
          Fee (₹)
        </label>
        <input
          id="fee"
          name="fee"
          type="text"
          required
          inputMode="decimal"
          value={fee}
          onChange={(event) => setFee(event.target.value)}
          autoComplete="off"
          className={styles.input}
          aria-invalid={state.errors.fee ? true : undefined}
          aria-describedby={state.errors.fee ? "fee-error fee-hint" : "fee-hint"}
        />
        <p id="fee-hint" className={styles.hint}>
          Total agreed fee for the selected membership period.
        </p>
        {state.errors.fee && (
          <p id="fee-error" role="alert" className={styles.error}>
            {state.errors.fee}
          </p>
        )}
      </div>

      <div className={styles.field}>
        <label htmlFor="plan" className={styles.label}>
          Membership plan
        </label>
        <select
          id="plan"
          name="plan"
          required
          value={plan}
          onChange={(event) => setPlan(event.target.value)}
          className={styles.select}
          aria-invalid={state.errors.plan ? true : undefined}
          aria-describedby={state.errors.plan ? "plan-error" : undefined}
        >
          <option value="">Choose a plan</option>
          {MEMBERSHIP_PLANS.map((value) => (
            <option key={value} value={value}>
              {PLAN_LABELS[value]}
            </option>
          ))}
        </select>
        {state.errors.plan && (
          <p id="plan-error" role="alert" className={styles.error}>
            {state.errors.plan}
          </p>
        )}
      </div>

      <div className={styles.field}>
        <label htmlFor="startDate" className={styles.label}>
          Start date
        </label>
        <input
          id="startDate"
          name="startDate"
          type="date"
          required
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
          className={styles.input}
          aria-invalid={state.errors.startDate ? true : undefined}
          aria-describedby={
            state.errors.startDate ? "startDate-error startDate-hint" : "startDate-hint"
          }
        />
        <p id="startDate-hint" className={styles.hint}>
          Choose the actual membership start date.
        </p>
        {state.errors.startDate && (
          <p id="startDate-error" role="alert" className={styles.error}>
            {state.errors.startDate}
          </p>
        )}
      </div>

      {showSummary && (
        <section className={styles.summary} aria-label="Membership summary">
          <h2>Membership summary</h2>
          <dl>
            <div className={styles.summaryRow}>
              <dt>Plan</dt>
              <dd>{validPlan ? PLAN_LABELS[validPlan] : "—"}</dd>
            </div>
            <div className={styles.summaryRow}>
              <dt>Fee</dt>
              <dd>{feePaise !== null ? formatInr(feePaise) : "—"}</dd>
            </div>
            <div className={styles.summaryRow}>
              <dt>Start date</dt>
              <dd>{parsedStartDate ? formatDate(parsedStartDate) : "—"}</dd>
            </div>
            <div className={styles.summaryRow}>
              <dt>Expiry date</dt>
              <dd>{expiryDate ? formatDate(expiryDate) : "—"}</dd>
            </div>
            <div className={styles.summaryRow}>
              <dt>Paid</dt>
              <dd>{formatInr(0)}</dd>
            </div>
            <div className={styles.summaryRow}>
              <dt>Outstanding</dt>
              <dd>{feePaise !== null ? formatInr(feePaise) : "—"}</dd>
            </div>
          </dl>
        </section>
      )}

      <div className={styles.actions}>
        <button type="submit" disabled={isPending} className={styles.button}>
          {isPending ? "Adding…" : "Add member"}
        </button>
        <Link href="/app/org/members" className={styles.secondaryButton}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
