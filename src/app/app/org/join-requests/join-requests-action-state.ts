/**
 * Shared form-state shapes for the join-request decision UI.
 *
 * This module intentionally has NO "use server" directive and no
 * server-only imports: Next.js requires a "use server" module to
 * export async functions only, so the types and initial-state
 * constants the client component needs live here (the payment-claims
 * section's payment-claims-action-state.ts pattern).
 */

export interface JoinRequestDecisionState {
  ok: boolean;
  /** Safe, user-facing outcome message (never internal details). */
  message: string | null;
  /** Field-level validation messages, keyed by form field. */
  errors: Partial<Record<"plan" | "fee" | "startDate", string>>;
}

export const INITIAL_JOIN_REQUEST_DECISION_STATE: JoinRequestDecisionState = {
  ok: false,
  message: null,
  errors: {},
};
