"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { newIdempotencyToken } from "@/lib/idempotency";
import {
  MAX_REVERSAL_EXPLANATION_LENGTH,
  PAYMENT_REVERSAL_REASONS,
  type PaymentReversalReason,
} from "@/lib/members";

import {
  INITIAL_PAYMENT_REVERSAL_FORM_STATE,
  reversePaymentAction,
} from "../../../../actions";
import styles from "../../../../members.module.css";

/**
 * Staff-facing short labels for the reason categories. Members see
 * the approved friendly labels (PAYMENT_REVERSAL_REASON_LABELS)
 * instead; staff interfaces may show the raw category.
 */
const STAFF_REASON_LABELS: Record<PaymentReversalReason, string> = {
  DUPLICATE_ENTRY: "Duplicate entry",
  WRONG_MEMBER: "Wrong member",
  WRONG_AMOUNT: "Wrong amount",
  PAYMENT_FAILED: "Payment did not go through",
  REFUNDED_TO_MEMBER: "Refunded to member",
  OTHER: "Other",
};

function paiseToDecimalString(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const remainder = String(paise % 100).padStart(2, "0");
  return `${rupees}.${remainder}`;
}

/**
 * Reverse Payment form.
 *
 * The amount is prefilled with the amount that can still be reversed
 * and may be lowered for a partial reversal. The server enforces
 * authorization (OWNER/ADMIN only), tenant isolation, the cumulative
 * invariant, and validation — this form only renders the returned
 * state.
 */
export function ReversePaymentForm({
  memberId,
  paymentId,
  remainingPaise,
}: {
  memberId: string;
  paymentId: string;
  remainingPaise: number;
}) {
  const [state, formAction, isPending] = useActionState(
    reversePaymentAction,
    INITIAL_PAYMENT_REVERSAL_FORM_STATE,
  );
  // One idempotency token per intentional reversal (H4 pattern): it is
  // minted when this form instance mounts and resubmitted unchanged on
  // every retry, so a double-click or a retry after a lost response
  // resolves to the original reversal instead of creating a second
  // one. A successful submit navigates away, so the next reversal gets
  // a fresh form — and a fresh token.
  const [idempotencyToken] = useState(() => newIdempotencyToken());

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="paymentId" value={paymentId} />
      <input type="hidden" name="idempotencyToken" value={idempotencyToken} />

      {state.message && (
        <p role="alert" className={styles.formError}>
          {state.message}
        </p>
      )}

      <div className={styles.field}>
        <label htmlFor="amount" className={styles.label}>
          Amount to reverse (₹)
        </label>
        <input
          id="amount"
          name="amount"
          type="text"
          required
          inputMode="decimal"
          defaultValue={paiseToDecimalString(remainingPaise)}
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
        <label htmlFor="reason" className={styles.label}>
          Reason
        </label>
        <select
          id="reason"
          name="reason"
          required
          defaultValue=""
          className={styles.select}
          aria-invalid={state.errors.reason ? true : undefined}
          aria-describedby={state.errors.reason ? "reason-error" : undefined}
        >
          <option value="" disabled>
            Choose a reason
          </option>
          {PAYMENT_REVERSAL_REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {STAFF_REASON_LABELS[reason]}
            </option>
          ))}
        </select>
        {state.errors.reason && (
          <p id="reason-error" role="alert" className={styles.error}>
            {state.errors.reason}
          </p>
        )}
      </div>

      <div className={styles.field}>
        <label htmlFor="explanation" className={styles.label}>
          Explanation (optional)
        </label>
        <textarea
          id="explanation"
          name="explanation"
          rows={3}
          maxLength={MAX_REVERSAL_EXPLANATION_LENGTH}
          className={styles.textarea}
          aria-invalid={state.errors.explanation ? true : undefined}
          aria-describedby={
            state.errors.explanation ? "explanation-error" : undefined
          }
        />
        {state.errors.explanation && (
          <p id="explanation-error" role="alert" className={styles.error}>
            {state.errors.explanation}
          </p>
        )}
      </div>

      <p className={styles.hint}>
        Reversing records a correction in the gym&apos;s books — the
        original payment stays in the history and the member&apos;s paid
        total is reduced. It does not send money back through a bank or
        payment gateway; if money is owed to the member, the gym returns
        it separately.
      </p>

      <div className={styles.actions}>
        <button type="submit" disabled={isPending} className={styles.button}>
          {isPending ? "Reversing…" : "Reverse payment"}
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
