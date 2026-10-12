/**
 * Shared form-state shapes for the payment claim review UI.
 *
 * This module intentionally has NO "use server" directive and no
 * server-only imports: Next.js requires a "use server" module to
 * export async functions only, so the types and initial-state
 * constants the client component needs live here (the staff section's
 * staff-action-state.ts pattern).
 */

export interface ClaimDecisionState {
  ok: boolean;
  /** Safe, user-facing outcome message (never internal details). */
  message: string | null;
  /** Field-level validation messages, keyed by form field. */
  errors: Partial<Record<"amount", string>>;
}

export const INITIAL_CLAIM_DECISION_STATE: ClaimDecisionState = {
  ok: false,
  message: null,
  errors: {},
};
