"use client";

import { useActionState, useState } from "react";
import type { Role } from "@prisma/client";

import {
  addStaffAction,
  changeStaffRoleAction,
  lookupStaffCandidateAction,
  revokeStaffAccessAction,
} from "./actions";
import {
  INITIAL_STAFF_LOOKUP_STATE,
  INITIAL_STAFF_MUTATION_STATE,
} from "./staff-action-state";
import styles from "./staff.module.css";

/**
 * Interactive staff management for one gym.
 *
 * Everything this component renders was decided on the server: the rows
 * carry per-row capability flags (canManage, isSelf) computed from the
 * service's permission matrix, and the role options are the actor's
 * grantable roles. The component never sees local user IDs or Clerk
 * IDs, never decides permissions itself, and never claims success
 * before the server action returns it — the service re-checks every
 * mutation server-side regardless of what this UI allowed.
 */

export interface StaffRow {
  membershipId: string;
  displayName: string | null;
  role: Role;
  /** Pre-formatted "Added 8 Oct 2026" label from the server. */
  addedLabel: string;
  isSelf: boolean;
  canManage: boolean;
}

const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  STAFF: "Staff",
  TRAINER: "Trainer",
  MEMBER: "Member",
};

interface StaffManagerProps {
  organizationName: string;
  rows: StaffRow[];
  grantableRoles: Role[];
  canManageStaff: boolean;
}

export function StaffManager({
  organizationName,
  rows,
  grantableRoles,
  canManageStaff,
}: StaffManagerProps) {
  return (
    <>
      {canManageStaff && (
        <AddStaffSection
          organizationName={organizationName}
          grantableRoles={grantableRoles}
        />
      )}
      <section className={styles.section} aria-label="Staff list">
        <h2>Staff</h2>
        {rows.length === 0 ? (
          <div className={styles.stateBox}>
            <h2>No staff to show</h2>
            <p>
              Nobody has staff access to {organizationName} yet. Add an
              existing account above to get started.
            </p>
          </div>
        ) : (
          <ul className={styles.list}>
            {rows.map((row) => (
              <li key={row.membershipId} className={styles.row}>
                <div className={styles.rowHeader}>
                  <span className={styles.rowName}>
                    {row.displayName ?? "Name unavailable"}
                  </span>
                  <span className={styles.badge}>
                    {ROLE_LABELS[row.role]}
                  </span>
                  {row.isSelf && <span className={styles.rowMeta}>(You)</span>}
                </div>
                <span className={styles.rowMeta}>{row.addedLabel}</span>
                {row.canManage && (
                  <StaffRowActions
                    row={row}
                    organizationName={organizationName}
                    grantableRoles={grantableRoles}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function AddStaffSection({
  organizationName,
  grantableRoles,
}: {
  organizationName: string;
  grantableRoles: Role[];
}) {
  const [lookupState, lookupAction, lookupPending] = useActionState(
    lookupStaffCandidateAction,
    INITIAL_STAFF_LOOKUP_STATE,
  );
  const candidate = lookupState.candidate;

  return (
    <section className={styles.section} aria-label="Add staff">
      <h2>Add staff</h2>
      <p className={styles.rowMeta}>
        Staff must already have an account. Ask them to sign in first,
        then add them by the email address on their account.
      </p>
      <form action={lookupAction} className={styles.form}>
        <div className={styles.field}>
          <label htmlFor="staff-email">Email address</label>
          <input
            id="staff-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={lookupState.email}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="staff-role">Role</label>
          <select
            id="staff-role"
            name="role"
            defaultValue={lookupState.role}
          >
            {grantableRoles.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={styles.button} disabled={lookupPending}>
          {lookupPending ? "Looking up…" : "Look up"}
        </button>
      </form>
      {lookupState.message && (
        <p className={`${styles.message} ${styles.messageError}`} role="alert">
          {lookupState.message}
        </p>
      )}
      {candidate && (
        <div key={candidate.email} className={styles.candidateBox}>
          <p>
            <strong>{candidate.displayName ?? "Name unavailable"}</strong>{" "}
            · {candidate.email}
          </p>
          {candidate.existingRole ? (
            <p>
              This person already has access to {organizationName} as{" "}
              {ROLE_LABELS[candidate.existingRole]}. To change their role,
              use the staff list below.
            </p>
          ) : (
            <AddStaffConfirm
              email={candidate.email}
              initialRole={lookupState.role}
              grantableRoles={grantableRoles}
            />
          )}
        </div>
      )}
    </section>
  );
}

function AddStaffConfirm({
  email,
  initialRole,
  grantableRoles,
}: {
  email: string;
  initialRole: Role;
  grantableRoles: Role[];
}) {
  const [state, formAction, isPending] = useActionState(
    addStaffAction,
    INITIAL_STAFF_MUTATION_STATE,
  );
  if (state.ok) {
    return (
      <p className={`${styles.message} ${styles.messageOk}`} role="status">
        {state.message}
      </p>
    );
  }
  return (
    <>
      <form action={formAction} className={styles.inlineForm}>
        <input type="hidden" name="email" value={email} />
        <div className={styles.field}>
          <label htmlFor={`add-role-${email}`}>Add as</label>
          <select id={`add-role-${email}`} name="role" defaultValue={initialRole}>
            {grantableRoles.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={styles.button} disabled={isPending}>
          {isPending ? "Adding…" : "Add to staff"}
        </button>
      </form>
      {state.message && (
        <p className={`${styles.message} ${styles.messageError}`} role="alert">
          {state.message}
        </p>
      )}
    </>
  );
}

function StaffRowActions({
  row,
  organizationName,
  grantableRoles,
}: {
  row: StaffRow;
  organizationName: string;
  grantableRoles: Role[];
}) {
  const [changeState, changeAction, changePending] = useActionState(
    changeStaffRoleAction,
    INITIAL_STAFF_MUTATION_STATE,
  );
  const [revokeState, revokeAction, revokePending] = useActionState(
    revokeStaffAccessAction,
    INITIAL_STAFF_MUTATION_STATE,
  );
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const name = row.displayName ?? "This person";

  return (
    <div>
      <div className={styles.rowActions}>
        <form action={changeAction} className={styles.inlineForm}>
          <input type="hidden" name="membershipId" value={row.membershipId} />
          <div className={styles.field}>
            <label htmlFor={`role-${row.membershipId}`}>Role</label>
            <select
              id={`role-${row.membershipId}`}
              name="role"
              defaultValue={row.role}
            >
              {grantableRoles.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className={styles.secondaryButton}
            disabled={changePending}
          >
            {changePending ? "Saving…" : "Change role"}
          </button>
        </form>
        {confirmingRevoke ? (
          <div className={styles.confirmBox}>
            <p>
              Revoke {name}&rsquo;s access to {organizationName}? They
              will lose staff access immediately.
            </p>
            <form action={revokeAction}>
              <input
                type="hidden"
                name="membershipId"
                value={row.membershipId}
              />
              <button
                type="submit"
                className={styles.dangerButton}
                disabled={revokePending}
              >
                {revokePending ? "Revoking…" : "Confirm revoke"}
              </button>
            </form>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => setConfirmingRevoke(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={styles.dangerButton}
            onClick={() => setConfirmingRevoke(true)}
          >
            Revoke access
          </button>
        )}
      </div>
      {changeState.message && (
        <p
          className={`${styles.message} ${
            changeState.ok ? styles.messageOk : styles.messageError
          }`}
          role={changeState.ok ? "status" : "alert"}
        >
          {changeState.message}
        </p>
      )}
      {revokeState.message && (
        <p
          className={`${styles.message} ${
            revokeState.ok ? styles.messageOk : styles.messageError
          }`}
          role={revokeState.ok ? "status" : "alert"}
        >
          {revokeState.message}
        </p>
      )}
    </div>
  );
}
