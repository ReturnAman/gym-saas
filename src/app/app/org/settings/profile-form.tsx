"use client";

import { useActionState } from "react";

import {
  INITIAL_PROFILE_FORM_STATE,
  updateOrganizationProfileAction,
} from "./actions";
import {
  MAX_ORGANIZATION_ADDRESS_LENGTH,
  MAX_ORGANIZATION_EMAIL_LENGTH,
  MAX_ORGANIZATION_NAME_LENGTH,
  MAX_ORGANIZATION_PHONE_LENGTH,
} from "@/lib/organization-profile";
import styles from "./settings.module.css";

export interface ProfileInitialValues {
  name: string;
  phone: string;
  email: string;
  address: string;
}

/**
 * Gym profile edit form (owner only — the page decides whether to render
 * this; the server action enforces it regardless).
 *
 * Validation feedback and the success state come from the server action's
 * returned state; native input attributes (required, type, maxLength) give
 * quick usability hints but the server remains authoritative.
 */
export function ProfileForm({ initial }: { initial: ProfileInitialValues }) {
  const [state, formAction, isPending] = useActionState(
    updateOrganizationProfileAction,
    INITIAL_PROFILE_FORM_STATE,
  );

  return (
    <form action={formAction} className={styles.form}>
      {state.message && (
        <p
          role={state.ok ? "status" : "alert"}
          className={state.ok ? styles.success : styles.formError}
        >
          {state.message}
        </p>
      )}

      <div className={styles.field}>
        <label htmlFor="name" className={styles.label}>
          Gym name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          maxLength={MAX_ORGANIZATION_NAME_LENGTH}
          defaultValue={initial.name}
          autoComplete="organization"
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
        <label htmlFor="phone" className={styles.label}>
          Phone
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          maxLength={MAX_ORGANIZATION_PHONE_LENGTH}
          defaultValue={initial.phone}
          autoComplete="tel"
          className={styles.input}
          aria-invalid={state.errors.phone ? true : undefined}
          aria-describedby={
            state.errors.phone ? "phone-error phone-hint" : "phone-hint"
          }
        />
        <p id="phone-hint" className={styles.hint}>
          Optional. Used for gym contact display.
        </p>
        {state.errors.phone && (
          <p id="phone-error" role="alert" className={styles.error}>
            {state.errors.phone}
          </p>
        )}
      </div>

      <div className={styles.field}>
        <label htmlFor="email" className={styles.label}>
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          maxLength={MAX_ORGANIZATION_EMAIL_LENGTH}
          defaultValue={initial.email}
          autoComplete="email"
          className={styles.input}
          aria-invalid={state.errors.email ? true : undefined}
          aria-describedby={state.errors.email ? "email-error" : undefined}
        />
        {state.errors.email && (
          <p id="email-error" role="alert" className={styles.error}>
            {state.errors.email}
          </p>
        )}
      </div>

      <div className={styles.field}>
        <label htmlFor="address" className={styles.label}>
          Address
        </label>
        <textarea
          id="address"
          name="address"
          rows={3}
          maxLength={MAX_ORGANIZATION_ADDRESS_LENGTH}
          defaultValue={initial.address}
          autoComplete="street-address"
          className={styles.textarea}
          aria-invalid={state.errors.address ? true : undefined}
          aria-describedby={state.errors.address ? "address-error" : undefined}
        />
        {state.errors.address && (
          <p id="address-error" role="alert" className={styles.error}>
            {state.errors.address}
          </p>
        )}
      </div>

      <div className={styles.actions}>
        <button type="submit" disabled={isPending} className={styles.button}>
          {isPending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
