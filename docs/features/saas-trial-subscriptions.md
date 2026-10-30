# Feature: SaaS trial & manual subscriptions

- Status: implemented (on branch `feature/saas-trial-subscriptions`); not yet released or deployed, with final integration and release verification outstanding
- Owner: —
- Related: docs/01-PRODUCT-REQUIREMENTS.md, docs/04-DATABASE-DESIGN.md, docs/05-AUTHORIZATION.md, docs/06-SECURITY.md

## Problem & users

Gym owners need a seven-day introductory trial when they create their
first gym, and the SaaS operator needs to manage continuation manually:
no payment gateway exists in V1, so activation, suspension,
reactivation, trial extensions, and discounts are all human-verified
platform-admin actions. Gym-member payments (money members pay their
gym) are a separate domain and must never be confused with SaaS
subscription payments (money gyms pay Gym SaaS).

## Requirements (functional)

- **Trial:** the first eligible organization creation grants exactly
  seven 24-hour periods (`trialStartedAt` → `trialEndsAt`, UTC,
  server-generated). A trial is live only while `now < trialEndsAt`.
- **One trial per owner AND per phone, forever.** Eligibility keys on
  the stable Clerk user ID and on the owner's canonical E.164 verified
  phone number (read from Clerk's Backend API, verification status
  exactly `verified`; never from browser input). Both are enforced by
  database unique constraints on `saas_trial_claims`, with advisory
  locks serializing concurrent claims. A second gym for the same owner
  or phone is created in `PENDING_PAYMENT`, never with a new trial.
  Claims are permanent: the organization link is `Restrict`, so
  deleting a gym, expiring a trial, or changing a phone number never
  releases a claim.
- **India-only owner phone entry (V1).** The onboarding form
  (`src/app/onboarding/page.tsx`) shows `+91` separately and accepts
  exactly 10 ASCII digits in the mobile field. The server action
  parses it strictly (`parseIndianMobileInput` in
  `src/lib/saas-phone.ts`): `+91…`, `91…`, leading-zero, spaced,
  punctuated, short, long, alphabetic, and non-ASCII-digit inputs are
  rejected, never truncated or corrected, and the gym is not created.
  A well-formed number is then matched against the canonicalized
  verified Clerk numbers (`findMatchingVerifiedPhone`); only the
  matched number can claim the trial. A number that matches nothing
  creates the gym in `PENDING_PAYMENT` with a subscription-screen
  notice explaining the number must match a verified number on the
  account. The lenient canonicalizer (`canonicalizePhoneNumber`) is
  unchanged and still used ONLY for trusted Clerk values and
  historical claim identities — it is not an entry-field parser.
  The first digit is restricted to 6–9 (the Indian mobile range);
  the verified-Clerk match remains the identity control, not the
  format check alone.
  Member phone entry is untouched by this change.
- **Fail closed:** no verified phone → no trial (gym still created,
  pending). Clerk lookup outage → creation aborts with a retryable
  error (the gym is not silently created trial-less). A gym with no
  subscription row resolves to `PENDING_PAYMENT`.
- **Effective states** (derived at request time, no scheduler needed):
  `SUSPENDED` overrides everything, then live paid (`ACTIVE`), then
  live trial (`TRIAL_ACTIVE`), then `EXPIRED` (had an entitlement,
  now lapsed), else `PENDING_PAYMENT`.
- **Enforcement is server-side:** owner/staff pages use
  `requireEntitledOrganizationContext` (restricted → `/app/subscription`),
  member pages use `requireEntitledMemberContext` (restricted →
  `/member/restricted`), mutations assert entitlement before and
  inside their transactions, and the member API routes map
  `SubscriptionRestrictedError` to 403 `SUBSCRIPTION_RESTRICTED`.
  The restricted owner screen itself is ungated (authentication +
  membership only) so recovery stays reachable.
- **Platform admin:** `/platform-admin`, allowlisted by
  `PLATFORM_ADMIN_CLERK_USER_IDS` (comma-separated Clerk user IDs,
  server-side only, fail closed). Dashboard metrics and org list come
  from live rows. Actions: record verified payment + activate,
  suspend (required reason + confirmation), extend trial (1–90 days,
  required reason), reactivate (only with a live underlying
  entitlement, or with a new paid period in the same transaction),
  approve/decline offers (only 5% or 10% on approval). Every mutation
  writes its audit event in the same transaction.
- **Owner experience:** trial status + server-derived remaining time
  on the org home and `/app/subscription`; the final-48-hour prompt
  ("Like how things are running? Let's help you keep going." /
  "Unlock your best offer") appears only while the trial is live and
  ≤48h remain, only without a pending/approved offer, and only until
  dismissed. Offer requests are idempotent (one pending per gym, also
  a partial unique index). No price, support contact, or payment link
  is invented: continuation is arranged with the Gym SaaS team, and
  agreed amounts/periods are administrator-entered when known.
- **No gateway:** Razorpay/Stripe/automatic collection/self-service
  extension are all out of scope for V1.

## API surface

No new public API routes. Server actions: owner offer
request/dismiss/accept (`src/app/app/subscription/actions.ts`);
platform-admin payment/suspend/extend/reactivate/offer-decision
(`src/app/platform-admin/actions.ts`). Existing member API routes
gain the 403 `SUBSCRIPTION_RESTRICTED` mapping.

## Data model

Migration `20261025125054_add_saas_subscriptions` (additive):

- `organization_subscriptions` — 1:1 with organizations; trial window,
  paid window (`paidThroughAt` mirrors the period end), suspension
  (timestamp, admin Clerk ID, reason), offer-prompt dismissal.
- `saas_trial_claims` — append-only ledger; `clerk_user_id` UNIQUE,
  `canonical_phone` UNIQUE (both global), `organization_id` Restrict.
- `saas_subscription_payments` — append-only; exact `DECIMAL(12,2)`,
  received date, optional reference, covered period, recording admin
  Clerk ID, notes, per-org idempotency key.
- `saas_offer_requests` — `REQUESTED/APPROVED/DECLINED/ACCEPTED`;
  discount %, expiry, applicable period, agreed amount, deciding
  admin; partial unique index: one `REQUESTED` row per gym.
- Audit reuse: existing `audit_logs` with `SAAS_*` event codes
  (trial granted/extended, payment recorded, suspended, reactivated,
  offer requested/approved/declined/accepted). Phone numbers in audit
  metadata appear masked only.

## Edge cases

- Trial extension applies from `max(now, trialEndsAt)` (live trials
  push out; expired trials restart from today).
- Recording a payment does NOT clear a suspension; reactivation is a
  separate explicit step.
- Reactivation without a live entitlement requires a paid period in
  the same call; expired entitlements never silently revive.
- The offer prompt never shows after expiry; offers approved with an
  expiry can only be accepted before it.
- Pre-existing gyms (no subscription row) are `PENDING_PAYMENT` until
  an admin acts — fail closed by design. Existing DB test fixtures
  seed a live-trial subscription row to mirror onboarding.
- India default in phone canonicalization: bare 10-digit numbers are
  treated as Indian mobiles; other countries must arrive in
  international (`+…`) form. Documented in `src/lib/saas-phone.ts`.

## Rollout & migration

1. Apply the migration (`npx prisma migrate deploy`) — additive, no
   data changes, no backfill (see edge case above).
2. Set `PLATFORM_ADMIN_CLERK_USER_IDS` in the deployment environment
   (never in source). Without it, `/platform-admin` admits nobody.
3. No deployment, payment gateway, pricing, or support channel is
   implied by this slice; those remain separate decisions.

## Test notes

- Unit: `src/lib/__tests__/saas-phone.test.ts` (canonicalization
  matrix, masking), `src/lib/server/__tests__/subscriptions.test.ts`
  (exact-expiry boundaries, suspension override, offer window),
  `src/lib/server/__tests__/platform-admin-allowlist.test.ts`
  (fail-closed allowlist, money/date validation),
  `src/lib/server/__tests__/platform-admin-payment-idempotency.test.ts`
  (record + reactivation token rules),
  `src/lib/server/__tests__/subscription-page-integrity.test.ts`
  (OWNER-only billing visibility),
  `src/app/app/subscription/actions.test.ts` (offer-prompt dismissal
  authorization),
  `src/lib/server/__tests__/clerk-verified-phone.test.ts`
  (verified-phone filtering).
- Database: `src/lib/server/__tests__/saas-trial-db.test.ts`
  (schema coherence + real-PG enforcement: one trial per owner/phone,
  formatting collision, concurrent claims, Restrict permanence,
  entitlement states, payment atomicity + member-payment isolation,
  suspend/reactivate (including replay, conflicting-payload,
  cross-gym, stale, and concurrent-submission cases),
  suspended-offer rejection, offer idempotency/window/5-or-10 rule).
  Registered in `scripts/run-db-tests.mjs`.
