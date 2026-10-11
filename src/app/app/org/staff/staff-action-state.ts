import type { Role } from "@prisma/client";

/**
 * Shared form-state shapes for the staff management UI.
 *
 * This module intentionally has NO "use server" directive and no
 * server-only imports: Next.js requires a "use server" module to
 * export async functions only, so the runtime constants and types the
 * client component needs live here, and actions.ts exports nothing
 * but Server Action functions. The candidate view is a structural
 * mirror of the staff service's public StaffCandidateResult (the
 * service remains the source of that contract; the actions assign its
 * result into this shape).
 */

export interface StaffCandidateView {
  email: string;
  displayName: string | null;
  existingRole: Role | null;
}

export interface StaffLookupState {
  ok: boolean;
  message: string | null;
  /** The email the lookup was run for (echoed so the form persists). */
  email: string;
  /** The role selected when the lookup ran. */
  role: Role;
  candidate: StaffCandidateView | null;
}

export const INITIAL_STAFF_LOOKUP_STATE: StaffLookupState = {
  ok: false,
  message: null,
  email: "",
  role: "STAFF",
  candidate: null,
};

export interface StaffMutationState {
  ok: boolean;
  message: string | null;
}

export const INITIAL_STAFF_MUTATION_STATE: StaffMutationState = {
  ok: false,
  message: null,
};
