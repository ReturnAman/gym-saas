# 20 — CURRENT STATE

**Project:** gym-saas
**Version:** 0.8 (draft — pending owner approval)
**Status:** Core feature set implemented and merged to GitHub `main`; not deployed and not ready for public launch.
**Last Updated:** 2026-10-21
**Baseline:** GitHub `main` @ `49e4959091200141a0015717d813d6ead16974dd`
**Latest CI:** run `39115484351` on `49e4959` — SUCCESS (build, db-tests, db-upgrade, e2e-auth)

> This revision records the migration upgrade-path test
> (Phase B, commit `49e4959`): CI now also upgrades a seeded
> database from the pinned previous release (10 migrations) to
> HEAD (12 migrations), closing the gap §8 recorded from the
> 2026-10-14 audit. Backups, restore testing, and deployment
> are unchanged — Phase B verifies migration upgrades only.
> A note added 2026-10-21 records payment reversals (§4.10):
> feature commit `ca43dc3` and documentation commit
> `a8f5a2c` are pushed to GitHub `main`. CI run
> `39649256109` on `a8f5a2c` completed successfully,
> including the build, database tests, database-upgrade, and
> authenticated e2e jobs. The baseline above describes the
> earlier baseline-specific evidence; §6 records the new CI run.
> Status words used below:
> **Completed** = implemented, tested, and merged to `main`;
> **Unverified** = code exists but the external integration has never
> run live; **Not started** = no implementation exists. Nothing in
> this document claims a deployment, backup, or provider integration
> that has not actually been exercised.

---

# 1. Purpose

This document records the current implementation and decision state
of the gym-saas project. It is the operational snapshot of the
repository: what has been decided, what has been implemented, what
remains open, and what must not change without approval. It is not a
replacement for the detailed architecture, security, product,
database, or API documents.

# 2. Product principles (unchanged, still governing)

- Gym member payments are paid **directly to the gym**. The SaaS does
  not hold or transfer gym membership money.
- A **payment claim is not a confirmed payment**. A member-reported
  payment counts only after owner/staff verification creates a ledger
  payment. Future payment gateways must plug into the same ledger.
- No Razorpay (or any gateway) in V1. Payment reference is optional
  for every method.
- A recorded payment **never renews, extends, or reprices** a
  membership; payment and renewal are separate domains.
- The permanent gym QR **identifies the gym only**; it does not
  authenticate anyone and does not prove physical presence
  (ADR 022). The phone number is discovery only; the OTP proves
  control of the phone. The system never reveals whether an arbitrary
  phone number belongs to a gym.
- Clerk authenticates owners/staff; member authentication is a
  separate SMS-OTP path (APITxT delivery; OTP generation and
  verification are application-owned) that never reads Clerk state
  (two-hats rule, ADR 021).

# 3. Architecture and security baseline

- Next.js + TypeScript modular monolith; PostgreSQL + Prisma;
  application-owned authorization with roles
  OWNER / ADMIN / STAFF / TRAINER / MEMBER.
- Every tenant-scoped read and write is pinned to an organization
  resolved server-side from the authenticated actor; client-supplied
  tenant/member identifiers are never trusted.
- Money-writing and staff mutations revalidate the actor inside the
  transaction (earliest organization-membership row locked
  `FOR UPDATE`, role re-derived from the locked row) — the pattern is
  uniform across staff management, payment recording, and claim
  verification, and is proven by genuine revocation-race tests
  against real PostgreSQL.
- Financial and staff events are audited (payments, payment claims,
  staff changes, manual attendance).
- Balances are always derived (sum of confirmed payments against the
  latest membership; outstanding floored at ₹0), never stored.
- Payment writes are idempotent: a client-generated token, bound to
  organization and operation and enforced by a database unique
  constraint, ensures one intentional recording or claim
  confirmation creates at most one payment (§4.8).

# 4. What is implemented and merged to GitHub main

## 4.1 Foundation, owner auth, onboarding
Clerk authentication foundation, organization-owner onboarding, gym
profile settings. CI uses a dedicated throwaway Clerk development
instance ("Gym SaaS CI"); no production Clerk instance exists yet.

## 4.2 Member management
Staff-managed member records with memberships (plan, fee, dates),
derived membership and payment status, member list and detail pages.

## 4.3 Payments V1 (ledger)
Staff-recorded confirmed payments against the latest membership:
partial payments allowed, overpayment allowed, outstanding derived
and floored at ₹0, every recording audited. There is no separate
charge model — the membership fee is the amount due.

## 4.4 Member OTP, sessions, and linking — code complete, delivery UNVERIFIED
APITxT SMS delivery with application-owned OTP generation and
verification (only a keyed HMAC digest of each code is stored;
verification is a local constant-time comparison — there is no
provider verification call), with DB-backed rate limiting
(30-second resend cooldown, 5/phone/hour, 100/org/hour, 5-minute
challenge TTL, 5 attempts then locked), anti-enumeration responses,
phone-backed member sessions (SHA-256 token hash only, 30-day
absolute / 7-day idle expiry), and atomic candidate linking. OTP
issuance is intent-aware: the default (`link`) eligibility rule
described here is unchanged, and an explicit `join` intent issues
real challenges to phones with no member record, for the
join-request flow in §4.9.
**Unverified:** the live APITxT delivery path has never been
exercised — neither the APITxT API key nor the OTP HMAC secret has
been provisioned and no live OTP round-trip has been performed.
The APITxT account's default SMS OTP configuration also still
needs to be set up for the owner's selected no-DLT route;
regulatory compliance has not been independently established.
The OTP endpoints return a safe "unavailable" response when
unconfigured.

**Phase M3a rate-limiting hardening (implemented 2026-11-06,
uncommitted on the APITxT branch).** A per-IP dimension now
complements the per-phone/per-org limits: OTP requests are counted
in a database-backed fixed-window bucket store
(`rate_limit_buckets`; keys are HMAC hashes of the
platform-observed client IP — raw addresses are never stored or
logged — and increments are atomic upserts, so counts are shared
across replicas). `RATE_LIMIT_IP_MODE` is `off`/`shadow`/`enforce`
and defaults to **shadow**: exceedances of the candidate ceiling
(60 requests/IP/hour across all gyms) are counted and logged but
never block. Enforce mode folds a block into the same synthetic
response as every other non-issuance. The 60/hour value is a
candidate, NOT production-calibrated — it must be validated
against shadow observations on staging (including confirmation
that Railway's forwarded-header behavior matches the
single-trusted-proxy assumption in `client-ip.ts`) before
enforcement is enabled. Issuance is also serialized per
(organization, phone) by an advisory lock across
check → send → insert (one transaction; Prisma's 5s default
timeout is raised to 20s explicitly because the transaction spans
the provider's 10s send cap), and verification attempts are
counted by an atomic conditional increment — concurrent requests
can no longer multiply SMS sends or exceed the attempt budget.
Observation without an admin UI: accepted-send volume is the
count of challenge rows (for example per day); note carefully
that accepted sends are NOT delivered messages and NOT charged
wallet amounts — delivery and charging depend on the provider,
whose per-OTP price and refund behavior remain unverified, so
challenge counts must never be reported as rupee spend. No hard
global OTP cap exists by design (it would be a platform-wide
denial-of-service switch). M3b (organization-creation cap,
readiness cache, staff-lookup throttle) is not implemented.

## 4.5 Attendance (Slices 1 + 2)
Manual staff check-in/check-out with one-open-session enforcement,
expired-membership warning with server-driven confirmation, and
no-membership blocking; member self-check-in via the gym QR (expired
memberships blocked at self-check-in), sign-in UI, attendance
history, printable QR poster, and an in-app QR scanner. "Today" is
the Asia/Kolkata day. TRAINER may check members in; check-out remains
OWNER/ADMIN/STAFF.
**Unverified:** camera/scanner behavior has never been tested on a
physical iPhone or Android device; it rests on documented
WebKit/Chromium behavior only.

## 4.6 Staff management
Existing-account-first model (a person signs in with Clerk first;
staff never create accounts or send invitations): OWNER grants
ADMIN/STAFF/TRAINER, ADMIN grants STAFF/TRAINER, OWNER can never be
assigned or removed through this flow, no self-change/self-removal,
and at least one OWNER always remains (enforced transactionally).
Email lookup uses the Clerk Backend API with exact verified-email
matching; the local `User` record stores no email. UI at
`/app/org/staff`.

## 4.7 Payment claims (C1 service + C2 member surface + C3 staff review)
- **C1 (service, merged 2026-10-11):** `PaymentClaim` lifecycle
  PENDING → CONFIRMED / REJECTED; exact-duplicate pending claims
  blocked by a partial unique index; at most 3 pending claims per
  membership (enforced by locking the membership row); confirmation
  is one transaction — conditional state transition, exactly one
  linked ledger payment for the amount actually received (which may
  differ from, and exceed, the claimed amount), and both
  `PAYMENT_CLAIM_CONFIRMED` and `PAYMENT_CONFIRMED` audit events.
  Claims never enter balance derivation.
- **C2 (member surface, commit `49d1a4f8`):**
  `POST /api/member-payments/claims` (identity only from the member
  session; body identity fields ignored) and `/member/payments`,
  where a member sees their latest membership, derived balance, and
  their own claims in plain language — pending claims are labelled as
  not counting as paid yet.
- **C3-S1 (staff reads, commit `2d12e8f3`):** review-queue and
  per-member claim-history reads with server-side role enforcement
  (OWNER/ADMIN/STAFF) and org pinning.
- **C3-S2 (staff queue UI, commit `548e60b3`):**
  `/app/org/payment-claims` — confirm with an editable
  "amount actually received" (defaults to the claimed amount) or
  two-step reject. Server actions take the actor only from the
  authenticated session; cache revalidation uses only fixed,
  trusted paths (no client-submitted identifier can influence it —
  regression-tested).
- **C3-S3 (member-detail history, commit `57796bd1`):** read-only
  claim history on `/app/org/members/[id]`, shown only to roles that
  may verify claims; foreign/nonexistent members still return the
  indistinguishable not-found behavior.

## 4.8 Operational hardening (H1–H4, commits `d190503` + `a046fcb`)
- **H1 — Database pool configuration:** the Prisma PostgreSQL
  adapter is built from explicit, validated settings instead of
  driver defaults: pool max **8 connections**, 5-second
  pool-acquisition timeout, 30-second idle timeout, 15-second
  server-side statement timeout. Optional environment overrides
  (`DB_POOL_MAX`, `DB_POOL_CONNECTION_TIMEOUT_MS`,
  `DB_POOL_IDLE_TIMEOUT_MS`, `DB_STATEMENT_TIMEOUT_MS`) fail startup
  when invalid. Sized for a small database connection budget
  (web 8 + migrations ~2 + operations ~2 within a 20-connection
  allowance).
- **H2 — Safe database-failure handling:** Prisma/pg failures are
  classified (connection loss / pool timeout / statement timeout)
  and mapped to safe responses: API routes return
  `503 DATABASE_UNAVAILABLE` without leaking internals, and server
  actions show a temporary-unavailable message. Payment paths treat
  a lost connection as *ambiguous* — staff are told to check the
  member's payment history and balance before recording again, and
  writes are never retried blindly. Business errors are never
  relabelled as database failures.
- **H4 — Payment idempotency:** `recordPayment` and claim
  confirmation accept a client-minted token (one per form mount),
  stored on the payment and protected by a unique constraint on
  `(organization_id, idempotency_key)`. Replaying a token with the
  same payload returns the original payment with no new payment or
  audit; replaying it with a different payload is rejected;
  cross-operation reuse (a direct-payment token in a claim
  confirmation, or vice versa) is rejected; a fresh token permits a
  genuinely separate payment of the same amount. Behavior without a
  token is unchanged.
- **H3 — Structured logging and correlation IDs:** server-only
  modules emit one single-line JSON record per failure at response
  boundaries only (API routes and the three central server-action
  translators), with the event, boundary, and a validated
  `x-request-id` correlation ID (untrusted values are rejected and
  replaced). Redaction is by construction: error messages are never
  logged and only allowlisted fields are emitted; the logging
  helpers are non-throwing even for hostile error objects, so
  logging can never mask the original error. Audit events remain a
  separate system. Known limit: member create/update, attendance,
  settings, and onboarding actions have no shared error translator,
  so their failures are not yet logged (§8).

## 4.9 Member join requests and staff decisions (Slices 1 + 2, commits `5f5aedf`, `e8122b1`, `1cc6b88`)

A person who opens a gym's invitation link/QR can now ask to join
that gym before any member record exists:

- **Submission** (`POST /api/member-auth/join-request`, service
  `src/lib/server/member-join-requests.ts`): after OTP verification,
  the person submits name, requested plan, proposed fee, and
  proposed start date — all required and validated with the shared
  member-input validators *before* the verified challenge is
  claimed, so a form error never consumes the challenge. Submission
  is a single transaction: atomic challenge claim (the identical
  conditional update linking uses), resolution of the phone-backed
  `User`, the request row, and a `MEMBER_JOIN_REQUESTED` audit
  event. The challenge is consumed only when a request is created.
- **The phone-only User shell is deliberate and bounded:** the
  audit schema requires an actor (`audit_logs.actor_user_id` is
  NOT NULL with a user FK), so submission resolves/creates the
  phone-backed `User` with an upsert whose create carries only
  the verified phone and whose update is empty — no name, email,
  Clerk identity, role, `OrganizationMembership`, or session is
  ever created, and no `Member`, `Membership`, payment, or claim
  either (all asserted by database tests). The shell grants no
  authentication or authorization anywhere.
- **Existing members never produce requests:** the service
  re-resolves member candidates for the (gym, verified phone)
  inside the transaction, mirroring linking's partition. Any
  existing record — linkable, already linked to this user, linked
  to another user, or duplicated — yields no request row
  (`ALREADY_REGISTERED` for the caller's own states, the generic
  failure otherwise). The endpoint, never the UI, decides; the
  sign-in UI's "Request to join" entry is static and unconditional.
- **Duplicates:** a partial unique index
  (`member_join_requests_one_pending_per_phone` on
  `(organization_id, phone_number) WHERE status = 'PENDING'`)
  makes a second pending request per gym + phone impossible;
  concurrent submissions resolve to the existing request (a
  per-phone advisory lock serializes first-time submissions, and
  a P2002 from the index resolves to the already-pending outcome).
- **Queue and decisions** (`/app/org/join-requests`): OWNER /
  ADMIN / STAFF only (TRAINER excluded — the queue exposes phone
  numbers of non-members), scope pinned to the actor's own gym,
  oldest first, capped at 100 with the total pending count shown.
  A submitted request by itself does not activate a membership,
  confirm a fee, or record a payment; staff decide each request
  from the queue (Slice 2, below).
- **Join-intent OTP eligibility** (commit `e8122b1`):
  `requestMemberOtp` takes an explicit `intent`. Exactly `"join"`
  skips the member-row eligibility check and issues a real
  challenge to any valid phone, so a genuine newcomer can
  complete OTP; absent, `"link"`, or any unrecognized value keeps
  the original link-path behaviour byte-identically. Intent
  selects only the SMS-eligibility rule — never authorization —
  and the anti-enumeration response contract is unchanged (a
  real or synthetic `{ challengeId }` in every case). Rate
  limits count challenge rows regardless of intent, so the
  30-second cooldown and the 5/phone/hour and 100/gym/hour caps
  are shared across intents. A VERIFIED challenge is
  intent-agnostic by design: cross-intent use is neutralized by
  each consuming endpoint's own revalidation (a newcomer's
  challenge fails linking generically; a member's challenge at
  the join endpoint returns `ALREADY_REGISTERED`); challenge
  purpose-binding was considered and deliberately not
  implemented. Residual exposure, accepted and recorded: SMS can
  now be triggered to arbitrary numbers within the caps, and
  rotating across gyms multiplies the per-gym cap (tracked under
  M3 in §8). Live APITxT delivery remains unverified, as in §4.4.
- **Approve / reject decisions** (Slice 2, commit `1cc6b88`;
  service functions `approveJoinRequest` / `rejectJoinRequest`):
  each decision is ONE transaction — the actor's role is
  revalidated inside the transaction (their membership row in
  the request's own gym is locked `FOR UPDATE`; OWNER / ADMIN /
  STAFF only), a per-(gym, phone) advisory lock is taken, and
  the request flips only from PENDING (a conditional update), so
  concurrent or repeated decisions cannot both land. Approval
  then resolves the member exactly as linking does: a member
  linked to a different user, multiple unlinked records, or the
  requester already linked to a different member in the gym all
  abort the decision as a conflict and leave the request
  PENDING; exactly one unlinked record is **adopted** (only its
  `userId` is set — its staff-recorded name is kept; nothing is
  merged); otherwise a new member is created from the request's
  name and verified phone, linked to the requester's user. If
  the resolved member already has **any** membership, approval
  aborts — it never stacks a second period. Otherwise the
  initial membership is created from the staff-confirmed terms
  (plan, fee, start date — prefilled from the request, editable
  at decision time, validated server-side) with the expiry date
  **derived by `calculateExpiryDate`**, exactly as in staff
  member creation. The request row records `decidedByUserId`,
  `decidedAt`, and (on approval) `resultingMemberId`, and the
  decision audit (`MEMBER_JOIN_REQUEST_APPROVED` /
  `MEMBER_JOIN_REQUEST_REJECTED`) is written in the same
  transaction. Rejection creates nothing. Approval creates **no
  payment, no debt record, and no inferred historical dues**:
  the new membership's outstanding is the usual derived figure
  — its fee minus its confirmed payments — which at approval is
  simply the full fee, because no payments exist yet; money
  moves only afterwards, through the existing payment flows.
  The same advisory lock is also taken by staff member creation
  (`createMemberWithMembership`), whose duplicate-phone check
  now runs inside its transaction under that lock, so approvals
  and manual creation for the same gym + phone linearize (see
  §9 for the convention this depends on). After approval the
  requester gets no session from the decision itself; their next
  sign-in links idempotently.
- **The `resultingMember` foreign key is corrected:**
  migration `20261017130000_restrict_join_request_result_member_fk`
  changed the composite FK from `ON DELETE SET NULL` (which
  would also have tried to null the required `organization_id`)
  to `ON DELETE RESTRICT`, before any code wrote the field.
  Deleting a member that a decided request produced now fails,
  preserving decision provenance (verified against PostgreSQL:
  the constraint's delete action is `RESTRICT`, and a database
  test proves a referenced member cannot be deleted while an
  unreferenced one can). No application flow deletes members.

## 4.10 Payment reversals — merged to GitHub main, not deployed

Payment reversals are included in GitHub `main` in feature commit
`ca43dc3` ("feat: add auditable payment reversals", on top of
`fc94b29`), followed by documentation commit `a8f5a2c`.
CI run `39649256109` on `a8f5a2c` completed successfully,
including build, database tests, database-upgrade, and e2e-auth.
The feature is merged and CI-verified, but it is not deployed.

An authorized staff user can reverse a confirmed payment, in
part or in full, by appending a `PaymentReversal` record
(migration `20261021120000_add_payment_reversals`; §5):

- Only OWNER and ADMIN may reverse; STAFF may record payments
  but never reverse them. The actor's role is revalidated
  inside the transaction.
- The original `Payment` record is never updated or deleted;
  the ledger stays append-only, and the reversal's payment
  link is `ON DELETE RESTRICT`.
- Amounts are exact integer paise, and the cumulative
  reversals against one payment can never exceed its amount —
  enforced under a lock on the payment row, so concurrent
  reversals cannot jointly over-reverse. A reversal and its
  `PAYMENT_REVERSED` audit event commit in one transaction,
  and a client idempotency token (unique per organization)
  makes a retried submission resolve to the original reversal.
- Every paid and outstanding figure derives net — confirmed
  payments minus their reversals — through the one aggregation
  (`sumConfirmedPaymentsByMembership`). A fully reversed
  payment stays visible in the payment history, marked
  "Fully reversed", with its Reverse action disabled.
- Each reversal carries a required reason category (six
  values) and an optional explanation of at most 280
  characters, stored on the reversal record only. Members see
  their reversals with plain-language reason labels; the
  member-facing view excludes staff identity and the free-text
  explanation.
- A reversal records a ledger correction only: it does not
  initiate or verify a bank or payment-gateway refund, it
  does not reopen a payment claim (a claim behind a reversed
  payment stays CONFIRMED), and it never changes membership
  dates or expiry.

Release gates are unchanged (§8): the reversal migration has
been verified only against a disposable local database, not
on staging, and hosting/provisioning, production Clerk, live
APITxT OTP delivery verification, and a tested backup/restore all remain
outstanding.

## 4.11 SaaS trial & manual subscriptions (implemented on branch `feature/saas-trial-subscriptions`, not yet released or deployed)

Implemented end to end on top of `main` at `9515714` (plus the
M1 bounded-list hardening, committed as `3e2267e` on the same branch,
preserved untouched):

- **Schema + migration `20261025125054_add_saas_subscriptions`:**
  `organization_subscriptions` (1:1 trial/paid/suspension state),
  `saas_trial_claims` (permanent ledger; global uniques on stable
  Clerk owner ID and canonical E.164 verified phone; organization link
  `Restrict`), `saas_subscription_payments` (append-only, exact
  `DECIMAL(12,2)`, per-org idempotency key), `saas_offer_requests`
  (`REQUESTED/APPROVED/DECLINED/ACCEPTED`, 5%/10% only on approval,
  partial unique index: one pending request per gym). Audit reuse:
  existing `audit_logs` with `SAAS_*` events, phone values masked.
- **Trial claim** (`createOrganizationWithSubscription`, onboarding
  action): verified phones come from Clerk's Backend API
  (verification status exactly `verified`, never browser input),
  canonicalized to E.164 (`src/lib/saas-phone.ts`; bare 10-digit
  numbers default to India, other countries must arrive with `+`).
  Claim attempts serialize on advisory locks (owner, then phones in
  sorted order); a P2002 backstop retries creation once, trial-less.
  No verified phone → gym created in `PENDING_PAYMENT`; Clerk lookup
  outage → creation aborts (retryable), never silently trial-less.
- **Entitlement** (`src/lib/server/subscriptions.ts`): effective state
  derived at request time (suspension override → paid → trial →
  expired → pending; live only while `now < endsAt`, exact-expiry
  tested). Owner/staff pages use
  `requireEntitledOrganizationContext` (restricted → `/app/subscription`),
  member pages use `requireEntitledMemberContext` (restricted →
  `/member/restricted`), mutations assert before and inside their
  transactions, and member API routes return 403
  `SUBSCRIPTION_RESTRICTED`. The subscription screen itself is ungated
  so restricted owners can always reach it.
- **Platform admin** (`/platform-admin`, allowlist
  `PLATFORM_ADMIN_CLERK_USER_IDS`, comma-separated Clerk IDs,
  fail closed; gym roles grant nothing): live metrics + searchable org
  list, detail page with payment/suspend/extend/reactivate/offer
  actions, all validated, transactional, and audited. Recording a
  payment does not clear a suspension; reactivation without a live
  entitlement requires a paid period in the same call.
- **Owner UI:** trial banner + final-48-hour offer prompt on the org
  home (prompt only while live, ≤48h remain, no pending/approved
  offer, not dismissed), full status/offer/payment view on
  `/app/subscription`. No price, support contact, or payment link is
  invented anywhere.
- **Tests:** unit coverage for phone canonicalization, resolver
  boundaries, allowlist/validators, payment idempotency (including
  reactivation tokens), and subscription-page integrity, plus a
  24-test real-PostgreSQL suite (`saas-trial-db.test.ts`,
  registered in `scripts/run-db-tests.mjs`) covering
  one-trial-per-owner/phone, formatting collision, concurrent claims,
  Restrict permanence, entitlement states, payment atomicity with
  member-payment isolation, suspend/reactivate (including replay,
  conflicting-payload, cross-gym, stale, and concurrent-submission
  cases), suspended-offer rejection, and offer
  idempotency/window/percentage rules.
  Existing DB suites' fixtures seed a live-trial subscription row to
  mirror onboarding (their intent unchanged); existing page-coherence
  tests were updated to the entitled context wrappers (strictly
  stronger: session + entitlement).
- **Not done / still gated:** nothing here is pushed, deployed, or
  released. No payment gateway, pricing, support channel, or
  production Clerk instance is implied. The platform-admin allowlist
  must be set in the deployment environment before `/platform-admin`
  admits anyone.
- **India-only owner phone entry (2026-10-25, same branch):** onboarding now collects exactly 10 digits with a
  separately displayed `+91` prefix. Strict server parsing
  (`parseIndianMobileInput`, `/^[6-9][0-9]{9}$/`) rejects
  country-code, leading-zero, first digits 0–5, spaced, punctuated,
  short, long, alphabetic, and non-ASCII input
  without truncation; the entered number must match a canonicalized
  verified Clerk number (`findMatchingVerifiedPhone`) or the gym is
  created in `PENDING_PAYMENT` with an explanatory notice. The
  `saas_trial_claims` uniques, advisory locks, and claim path are
  untouched; the lenient Clerk-value canonicalizer is unchanged. E2E
  auth setup fills the field from `CLERK_E2E_OWNER_PHONE`, which must
  match a verified number on the fixture account (unverifiable here:
  no live Clerk instance).
- **Final validation (2026-10-25, this branch, disposable local DB):**
  Prisma schema valid; lint 0 errors (1 pre-existing k6 warning);
  typecheck exit 0; unit suite 816 passed / 120 skipped; full
  `test:db` 164 passed / 0 skipped (SaaS suite 16/16); production
  build exit 0, 31 routes including `/platform-admin`,
  `/app/subscription`, `/member/restricted` (placeholder Clerk keys
  for page-data collection only). Two review caveats found during
  this pass were fixed before validation: dashboard headline metrics
  are now global rather than search-filtered, and the payment form
  carries one idempotency token per render so a double submit replays
  instead of recording twice. One disclosure: the generated migration
  also renames a pre-existing member-OTP index to Prisma's
  conventional name (pure rename, no data effect); it is kept so the
  migration matches what was applied to the disposable test DBs.
- **Final validation (2026-10-29, this branch, disposable local DB):**
  Prisma schema valid; lint 0 errors (1 pre-existing k6 warning);
  typecheck exit 0; unit suite 829 passed / 128 skipped; full
  `test:db` 172 passed / 0 skipped (SaaS suite 24/24, including the
  suspended-offer, payment-idempotency, reactivation-replay, and
  cross-gym concurrency cases); production build exit 0, 31 routes
  (placeholder Clerk keys for page-data collection only).

## 4.12 Membership renewal (implemented on branch `feature/saas-trial-subscriptions`, not yet released or deployed)

- **What it does:** `renewMembership` (`src/lib/server/members.ts`)
  starts a member's next period as a NEW Membership row; the old row
  is never modified. Renewing on or before expiry chains the new
  start to the day after expiry; renewing after expiry starts today
  (UTC days, `deriveRenewalStartDate`). Plan and fee default from
  the current period and are staff-confirmable; the expiry is
  staff-supplied (prefilled with an editable suggestion) and
  validated against the derived start — the service does no
  plan-duration arithmetic. OWNER/ADMIN/STAFF only; entitlement
  asserted before and inside the transaction; foreign member IDs
  return the identical not-found. One `MEMBERSHIP_RENEWED` audit
  per renewal, atomic with the row. Design:
  `docs/features/membership-renewal.md`.
- **Replay safety:** the renewal form's H4 token is required and
  stored on the created row (`renewal_idempotency_key`, migration
  `20261030120000_add_membership_renewal_idempotency_key`,
  expand-only) under an organization-scoped unique. Identical
  retries resolve to the original with no second row or audit;
  conflicting reuse is rejected. Resolution is three-layered
  (pre-transaction, in-transaction under token-then-member advisory
  locks, unique-violation backstop) and runs only after the
  caller's current authorization is re-verified. Concurrent
  different-token renewals serialize on the per-member lock and
  chain without forking.
- **Money and claims stay per-period:** renewal creates no Payment,
  claim, or reversal; the old period's outstanding stays on the old
  period. Pending claims do not block renewal (the form shows the
  count) and stay attached to their original period — confirming
  one after renewal pays the old period. The member detail page
  shows earlier periods read-only in a bounded Past memberships
  section (10 periods, per-period histories bounded as elsewhere);
  per-period paid/outstanding always derive from the central
  funnel. Member detail now loads the current period plus that
  bounded history with batched totals (one funnel call, one grouped
  pending-claim count).
- **Validation (2026-10-30, this branch, disposable local DB):**
  Prisma schema valid; lint 0 errors (1 pre-existing k6 warning);
  typecheck exit 0; unit suite 872 passed / 137 skipped; full
  `test:db` 181 passed / 0 skipped, including the new 9-test
  renewal DB suite (chaining with the old row byte-identical,
  expired → renewed → self check-in restored, same-token replay
  and conflict, concurrent same- and different-token submissions,
  cross-gym not-found with zero writes, TRAINER and suspended-gym
  denial, claim attachment). Production build exit 0 (placeholder
  Clerk keys for page-data collection only). Not pushed, merged,
  or deployed; the expand migration has run only on disposable
  local databases.

# 5. Data

Twelve migrations, all covered by CI: run `39115484351` on
`49e4959` completed SUCCESS, and the workflow's db-tests and
e2e-auth jobs each apply migrations with `prisma migrate
deploy` to a disposable PostgreSQL 16. The workflow's
db-upgrade job additionally upgrades a database seeded at the
pinned `a046fcb` schema (10 migrations) to HEAD and asserts
the seeded rows survive (§6). All twelve are also
verified locally by direct `prisma migrate deploy` against
PostgreSQL 16 (exit 0):

`20260928204500_add_application_user`,
`20260928213000_add_organizations_and_memberships`,
`20260929230000_add_organization_profile_fields`,
`20261001020000_add_members_and_memberships`,
`20261008230000_add_payments_and_audit_log`,
`20261009010000_add_member_otp_challenges`,
`20261009110000_add_member_sessions_and_phone_identity`,
`20261010103000_add_attendance_sessions`,
`20261011120000_add_payment_claims`,
`20261014120000_add_payment_idempotency_key` (nullable
`payments.idempotency_key` plus its unique index; keyless payments
never collide),
`20261017120000_add_member_join_requests` (the `member_join_requests`
table with composite tenant keys and the partial unique index that
caps one PENDING request per gym + phone; §4.9),
`20261017130000_restrict_join_request_result_member_fk` (the
`resultingMember` composite foreign key's delete action changed
from SET NULL to RESTRICT; no data changes; §4.9).

A thirteenth migration, `20261021120000_add_payment_reversals`
(the `payment_reversals` table with composite tenant keys,
the organization-scoped idempotency unique, and the backing
`payments(organization_id, id)` unique index; §4.10), is
included in GitHub `main` via commit `ca43dc3`. CI run
`39649256109` successfully applied all migrations to disposable
PostgreSQL 16 for db-tests and verified the upgrade path from
the pinned previous schema with seeded-row survival. No staging
or production database has been migrated.

# 6. Testing and CI (verified evidence)

CI (`.github/workflows/ci.yml`) has four jobs; run `39115484351` on
`49e4959` completed **SUCCESS**:

- **build**: install, Prisma generate + validate, lint,
  typecheck, Vitest, Playwright browser smoke tests, production
  build, docs consistency check.
- **db-tests**: migrations applied to a disposable
  PostgreSQL 16, then the real-database suites via
  `scripts/run-db-tests.mjs`, which fails closed on any skip or
  failure.
- **db-upgrade**: the pinned previous release (`a046fcb`,
  10 migrations) is applied to a disposable PostgreSQL 16, a
  small synthetic fixture is seeded, and the same database is
  upgraded to HEAD's migrations via
  `scripts/run-upgrade-test.mjs`; seeded-row survival, the
  resulting-member FK's RESTRICT action, and `test:db` against
  the upgraded database are all asserted. The runner refuses
  any non-disposable target before contacting a database
  (anchored `gymsaas_upgrade` naming, loopback hosts only, no
  target-overriding query parameters, and an explicit
  confirmation marker). Informational — not a required check.
- **e2e-auth**: authenticated OWNER smoke test through the
  real Clerk sign-in path against a disposable database.

Verified counts at the current baseline `49e4959`: Vitest
**711 passed / 93 skipped** (the skips are the database-gated
suites, which run under `test:db`, plus a small number of
pre-existing conditional skips); `test:db` **128/128 passed,
0 skipped** on real PostgreSQL 16 (including the join-request
submission, decision, and concurrency suites alongside
pool-configuration and payment-idempotency); Playwright default
suite **22 tests passed** in the build job (plus the separate
e2e-auth smoke suite, also green). The same battery was run
locally before the push (Node **20.20.2**, the CI Node major)
with identical results, and CI run `39115484351` confirms them
on GitHub. History note: commit
`885569f` is a temporary CI diagnostic from the Playwright
troubleshooting period; it is superseded and inert — no revert is
required.

Local verification was recorded before the final comment-only
cleanup and remains historical evidence only: Vitest
**766 passed / 108 skipped**, `test:db` **147/147 passed,
0 skipped** on disposable PostgreSQL 16, and lint, typecheck,
and production build passed. CI run `39649256109` on
`a8f5a2c` independently verifies the pushed feature and
documentation commits. Its build, db-tests, db-upgrade, and
e2e-auth jobs all succeeded. The database-upgrade job seeded
the pinned `a046fcb` schema and upgraded through all 13
migrations with seeded-row survival asserted. The migration
has not been applied to staging or production.

# 7. Deployment state

**Nothing is deployed anywhere, and nothing has been provisioned.**
GitHub `main` includes payment reversals through `a8f5a2c`;
CI run `39649256109` passed all four jobs for that commit.
The repository is host-compatible (Procfile with release-phase
`prisma migrate deploy`, Node `20.x` engine pin, Prisma CLI in
production dependencies — commit `1803c9b8`) but no host, database,
domain, or environment exists. **ADR 004 is still Proposed** — no
hosting decision has been taken. A Stage 0 staging review
recommends Render (Singapore; managed PostgreSQL with point-in-time
recovery) at an estimated $13/month; Heroku was assessed as
zero-cost staging via the student credit with material backup
limits (~24-hour recovery point, no PITR at the entry tier);
Railway is also under consideration and its plan-gating for PITR
is not yet verified. A production-readiness audit was completed on
2026-10-15 against `a046fcb`; its open items are reflected in §8.
No environment should hold real pilot data until backup and
restore requirements are satisfied and a restore has been tested.

# 8. Known launch blockers and outstanding work

Supported by current repository evidence unless marked otherwise:

1. **Hosting decision and provisioning** — ADR 004 unresolved; no
   production Clerk instance, domain, or environment variables exist
   outside CI. Stage 0 (staging, synthetic data only) is the agreed
   first step once a provider is chosen.
2. **APITxT live verification** — account default SMS OTP route
   configuration for the owner's selected no-DLT route, the API
   key and OTP HMAC secret (via secure configuration only), and
   one live OTP round-trip are all outstanding; until then member
   sign-in is unverified end to end.
3. **Backups and restore** — no backup schedule, restore drill, or
   off-platform copy exists for any future production database;
   recovery testing is an ADR 004 requirement before real data.
4. **Monitoring / alerting** — H3 structured logs are emitted to
   the platform log drain, but there is no log shipping, alerting,
   uptime monitoring, or error tracking; ADR 007 still Proposed
   (Sentry the leading candidate) and `SENTRY_DSN` in `.env.example`
   is read by no code.
5. **Membership renewal — Implemented on the feature branch,
   not yet released.** Renewal creates the next period as a new
   row with token-based replay protection; money and claims stay
   per-period, and earlier periods show read-only on the member
   page (§4.12). Payments still explicitly do not renew. What
   remains is release work only: push under its own approval,
   branch CI, and deployment with its expand migration.
6. **Payment correction / reversal — Merged and CI-verified,
   not yet deployed.** Append-only reversal records are merged
   in `main` (`ca43dc3`; §4.10), and CI run `39649256109`
   passed including the db-upgrade job over the new migration.
   Release still requires staging environment setup, staging
   migration verification, live OTP verification, production
   Clerk configuration, and a tested backup/restore plan.
7. **Remaining hardening (audit items M1–M3) — Partially
   complete.** M1a bounded-list hardening is implemented and
   merged (PR #4): the pending-claim queue, per-membership
   payment/reversal/claim histories, and today's attendance are
   capped, with exact totals still derived from the central money
   funnel. Remaining: M1b (payment-status grouped aggregate for
   the members list) is not started; M2 request-scoped scope
   memoization is not started. M3a OTP rate-limiting hardening
   (per-IP buckets in shadow mode by default, issuance
   serialization, atomic verify attempts) is implemented on the
   APITxT branch — see §4.4; M3b items and any rate limiting
   beyond the OTP request path are not started. Failure logging
   does not yet cover the member create/update, attendance,
   settings, or onboarding actions.
8. **Readiness probe — Implemented and merged.** `GET /api/ready`
   runs a single `SELECT 1` on the pooled client: 200 when the
   database answers, 503 with the shared database-unavailable
   body otherwise (PR #4). `/api/health` remains a liveness
   check only and does not test database reachability.
9. **PWA basics — Not started.** No `public/` directory, manifest,
    or icons exist.
10. **Gym switcher — Not started.** Staff and claims surfaces resolve
    the actor's primary (earliest) gym only; members can belong to
    multiple gyms but post-login gym selection is limited.
11. **Identity merge — Not started.** A person who is both staff and
    member temporarily has two user records by design (ADR 021).
12. **Owner dashboard** — the organization home is a link hub; no
    at-a-glance dues/expiry/attendance summary exists.
13. **SaaS billing/trial — Implemented and merged.** Seven-day
    trial with one-trial enforcement per Clerk owner identity and
    verified phone, manual SaaS subscription payments, platform-
    admin controls, and entitlement enforcement (PR #4; §4.11).
    Payments are manual in V1 by design; a payment-gateway
    integration is future work.
14. **Documentation debt** — ADR 023 (staff management) and ADR 024
    (payment claims) are not written; ADR 013 and ADR 017 remain
    Proposed although their patterns are implemented.

# 9. Known limitations (accepted, recorded)

- Membership selection everywhere keys off the latest membership by
  `createdAt`; rows created in the same transaction with identical
  timestamps have no further tie-break (no product flow creates
  them).
- A claim stays attached to the membership that was current at
  submission; after a future renewal the member's summary moves to
  the new membership while older claims remain in history.
- The member detail page reflects claim decisions on next load
  rather than via targeted cache revalidation (a deliberate
  consequence of the trusted-revalidation rule in §4.7).
- An idempotency token does not survive a hard page reload: a fresh
  form mount mints a fresh token, so a lost response followed by a
  reload and resubmission can still create a second payment. This
  is a deliberate boundary (a persisted token could be replayed
  against an unrelated payment); the duplicate is visible in the
  member's payment history, and the H2 check-first message covers
  the same-mount ambiguous case.
- Member-creation duplicate protection depends on a locking
  convention: the duplicate-phone check is serialized by the
  `member-decision:<gym>:<phone>` advisory lock, which every
  member-creating path must take (today both do — join-request
  approval and staff member creation). A future member-creating
  path that skipped the lock would reopen the concurrent-
  duplicate race the in-transaction check now prevents.
- A VERIFIED OTP challenge carries no record of the intent it was
  issued under (§4.9); the consuming endpoints' own revalidation
  is the control, and challenge purpose-binding is deliberately
  not implemented.
- CI runs on Node 20; GitHub has announced runner changes for
  Node 20 actions (informational annotation on current runs, no
  failures).

# 10. Next steps (each requires its own approval)

1. Decide hosting (resolve ADR 004) and provision a Stage 0 staging
   environment with synthetic data only; complete a timed restore
   drill before any real data is considered.
2. Provision the production Clerk instance and the APITxT account
   (default SMS OTP route configured); perform one live OTP
   round-trip.
3. Implement membership renewal. Verify the payment-reversal
   migration on staging after the staging environment is
   provisioned (§4.10).
4. Write ADR 023 and ADR 024; refresh this document after the
   deployment decision lands.
