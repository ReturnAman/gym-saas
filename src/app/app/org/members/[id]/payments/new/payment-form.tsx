"use client";

import Link from "next/link";
import { useActionState } from "react";

import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/lib/members";

import {
  INITIAL_PAYMENT_FORM_STATE,
  recordPaymentAction,
} from "../../../actions";
import styles from "../../../members.module.css";

/**
 * Record Payment form.
 *
 * Amount is entered as a decimal string and validated server-side into
 * exact integer paise. The reference is optional for every method in V1.
 * The server enforces authorization, tenant isolation, and validation —
 * this form only renders the returned state.
 */
export function RecordPaymentForm({ memberId }: { memberId: string }) {
  const [state, formAction, isPending] = useActionState(
    recordPaymentAction,
    INITIAL_PAYMENT_FORM_STATE,
  );

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="memberId" value={memberId} />

      {state.message && (
        <p role="alert" className={styles.formError}>
          {state.message}
        </p>
      )}

      <div className={styles.field}>
        <label htmlFor="amount" className={styles.label}>
          Amount received (₹)
        </label>
        <input
          id="amount"
          name="amount"
          type="text"
          required
          inputMode="decimal"
          placeholder="6000 or 6000.50"
          className={styles.input}
          aria-invalid={state.errors.amount ? true : undefined}
          aria-describedby={state.errors.amount ? "amount-error" : undefined}
        />
        {state.errors.amount && (
          <p id="amount-error" role="alert" className={styles.error}>
            {state.errors.amount}
          </p>
        )}
      </div>

      <div className={styles.field}>
        <label htmlFor="paymentMethod" className={styles.label}>
          Payment method
        </label>
        <select
          id="paymentMethod"
          name="paymentMethod"
          required
          defaultValue="UPI"
          className={styles.select}
          aria-invalid={state.errors.paymentMethod ? true : undefined}
          aria-describedby={
            state.errors.paymentMethod ? "paymentMethod-error" : undefined
          }
        >
          {PAYMENT_METHODS.map((method) => (
            <option key={method} value={method}>
              {PAYMENT_METHOD_LABELS[method]}
            </option>
          ))}
        </select>
        {state.errors.paymentMethod && (
          <p id="paymentMethod-error" role="alert" className={styles.error}>
            {state.errors.paymentMethod}
          </p>
        )}
      </div>

      <div className={styles.field}>
        <label htmlFor="reference" className={styles.label}>
          Reference (optional)
        </label>
        <input
          id="reference"
          name="reference"
          type="text"
          maxLength={120}
          placeholder="e.g. UPI transaction ID"
          className={styles.input}
          aria-invalid={state.errors.reference ? true : undefined}
          aria-describedby={state.errors.reference ? "reference-error" : undefined}
        />
        {state.errors.reference && (
          <p id="reference-error" role="alert" className={styles.error}>
            {state.errors.reference}
          </p>
        )}
      </div>

      <div className={styles.actions}>
        <button type="submit" disabled={isPending} className={styles.button}>
          {isPending ? "Recording…" : "Record payment"}
        </button>
        <Link
          href={`/app/org/members/${memberId}`}
          className={styles.secondaryButton}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
