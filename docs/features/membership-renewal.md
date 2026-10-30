# Feature: Membership renewal

Implemented 2026-10-30 on branch `feature/saas-trial-subscriptions`
(not pushed, merged, or deployed). Design source: the owner
decision sheet of 2026-10-22,
approved with the token-based idempotency alternative. Behavior is
implemented by `renewMembership` in `src/lib/server/members.ts`,
`renewMembershipAction` in `src/app/app/org/members/actions.ts`, and
the renewal form on the member detail page.

## Problem & users

Membership expiry existed but renewal did not: when a member's
period ended, member self check-in became a hard stop with no
in-product way to start the next period. Staff (OWNER, ADMIN,
STAFF) renew a member from the member detail page.

## Requirements (functional)

- Renewal creates a NEW `Membership` row; the previous row is never
  modified. Periods chain: renewing on or before the current expiry
  date starts the new period the following calendar day (no gap, no
  overlap, no paid days lost); renewing after expiry starts it on
  the renewal date (UTC calendar days, matching
  `deriveMembershipStatus`).
- ACTIVE, EXPIRING, and EXPIRED memberships are all eligible. A
  member with no membership row cannot be renewed (not-found
  behavior; no first membership is invented).
- Plan and fee default from the current membership and are
  staff-confirmable. The expiry date is prefilled with an editable
  suggestion (plan duration from the chained start, computed in the
  page/form layer only); the service performs no plan-duration
  arithmetic and validates the staff-confirmed date, which must not
  precede the derived start date.
- Authorization: OWNER, ADMIN, STAFF only (TRAINER denied). The
  organization always comes from the caller's own scope; a foreign
  or nonexistent member ID returns the identical not-found error.
  SaaS entitlement is asserted before the transaction and again
  inside it — a restricted gym cannot renew.
- Replay safety (H4): the form's idempotency token is required,
  stored on the created row as `renewal_idempotency_key` under an
  organization-scoped unique. An identical retry resolves to the
  original membership with no second row and no second audit event;
  reusing the token with a different member, plan, fee, or expiry is
  rejected as a conflict. Resolution runs on three layers
  (pre-transaction fast path, in-transaction recheck under advisory
  locks — token lock, then per-member lock, always in that order —
  and a unique-violation backstop) and only AFTER the caller's
  current scope, role, and entitlement are re-verified.
- Audit: exactly one `MEMBERSHIP_RENEWED` event per successful
  renewal, written in the same transaction as the new row, carrying
  the previous membership ID, plan, period dates, and fee in paise.
- Money stays per-period: renewal creates no Payment, claim, or
  reversal. The old period's outstanding stays on the old period;
  balances never carry over or merge.

## Claims

Pending payment claims never block renewal. The renewal form shows
the current period's pending-claim count. Claims stay attached to
the membership they were submitted against: confirming one after a
renewal pays down the OLD period, never the new one.

## UI surface

- Member detail page: a "Renew membership" section (OWNER/ADMIN/
  STAFF with a current membership only) with plan, fee, and expiry
  fields plus the pending-claim note.
- A read-only "Past memberships" section lists earlier periods
  (newest first, at most 10) with each period's own fee, paid,
  outstanding, payment status, and its payment/reversal history
  rendered in place — there is no per-period route, and none was
  invented. Paid/outstanding always derive from the central funnel
  per membership.

## Data model

One expand migration, `20261030120000_add_membership_renewal_idempotency_key`:
nullable `memberships.renewal_idempotency_key` plus a unique index
on `(organization_id, renewal_idempotency_key)`. PostgreSQL treats
NULL keys as distinct, so keyless memberships (the initial period
and all pre-renewal rows) never collide. No existing column,
constraint, or row changes; safe to apply while the previous release
runs.

## Edge cases

- Two concurrent renewals with the SAME token produce exactly one
  new period; both callers receive that period.
- Two concurrent renewals with DIFFERENT tokens serialize on the
  per-member lock and chain — the second re-reads the latest period
  under the lock, so periods never fork from the same base. If the
  winner's period pushes the chained start past the loser's
  confirmed expiry, the loser fails validation with the derived
  start date named; staff simply re-check and renew again.
- An expired member can self-check-in again immediately after
  renewal (status derives from the new latest period on every call).

## Test notes

Validated 2026-10-30 on this branch (disposable local DB): unit
suite 872 passed / 137 skipped; `test:db` 181 passed / 0 skipped,
including the new 9-test `members-renewal-db.test.ts` (registered
in `scripts/run-db-tests.mjs`) covering chaining with the old row
byte-identical, the expired → renewed → check-in transition,
same-token replay and conflict, concurrent same-token and
different-token submissions, cross-gym not-found with zero writes,
TRAINER and suspended-gym denial, and claim attachment across a
renewal. Unit suites cover the three chaining boundaries, defaults
and overrides, plan/fee/expiry/token validation, the role matrix,
replay resolution on all layers, action error mapping, the form's
token stability and defaults, and page rendering of the renewal
section (role-gated) and the Past memberships history. Lint 0
errors (1 pre-existing k6 warning); typecheck exit 0; production
build exit 0 (placeholder Clerk keys for page-data collection
only).
