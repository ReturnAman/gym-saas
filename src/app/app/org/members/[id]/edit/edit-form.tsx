"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  INITIAL_MEMBER_FORM_STATE,
  updateMemberAction,
} from "../../actions";
import styles from "../../members.module.css";

export interface EditMemberInitialValues {
  id: string;
  name: string;
  phoneNumber: string;
}

/**
 * Edit Member form — identity/contact fields only.
 *
 * Membership fields (plan, dates, fee) are intentionally not editable here:
 * rewriting them would silently alter historical meaning. The server
 * enforces the same boundary.
 */
export function EditMemberForm({ initial }: { initial: EditMemberInitialValues }) {
  const [state, formAction, isPending] = useActionState(
    updateMemberAction,
    INITIAL_MEMBER_FORM_STATE,
  );

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="memberId" value={initial.id} />

      {state.message && (
        <p role="alert" className={styles.formError}>
          {state.message}
        </p>
      )}

      {state.duplicates.length > 0 && (
        <div className={styles.duplicateWarning} role="alert">
          <h2>Phone number already in use</h2>
          <p>
            These members already use this phone number. Saving will keep both
            records — nothing will be merged.
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
              {isPending ? "Saving…" : "Save anyway"}
            </button>
            <Link
              href={`/app/org/members/${initial.id}`}
              className={styles.secondaryButton}
            >
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
          defaultValue={initial.name}
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
          defaultValue={initial.phoneNumber}
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

      <div className={styles.actions}>
        <button type="submit" disabled={isPending} className={styles.button}>
          {isPending ? "Saving…" : "Save changes"}
        </button>
        <Link
          href={`/app/org/members/${initial.id}`}
          className={styles.secondaryButton}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
