# 20 — CURRENT STATE

**Project:** gym-saas
**Version:** 0.3 (draft — pending owner approval)
**Status:** Core feature set implemented and merged to main; not deployed and not ready for public launch.
**Last Updated:** 2026-10-14
**Baseline:** `main` @ `57796bd10ef9d42572edba709c8b10d14be34f5a`
**Latest CI:** run `38447698232` — SUCCESS (build, db-tests, e2e-auth)

> This draft replaces the 2026-10-01 snapshot, which predates member
> management, payments, member OTP/sessions, attendance, staff
> management, and payment claims. Status words used below:
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
  separate 2Factor SMS-OTP path that never reads Clerk state
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

## 4.4 Member OTP, sessions, and linking — code complete, provider UNVERIFIED
2Factor AUTOGEN/VERIFY foundation with DB-backed rate limiting
(30-second resend cooldown, 5/phone/hour, 100/org/hour, 5-minute
challenge TTL, 5 attempts then locked), anti-enumeration responses,
phone-backed member sessions (SHA-256 token hash only, 30-day
absolute / 7-day idle expiry), and atomic candidate linking.
**Unverified:** the live 2Factor wire details have never been
exercised — no API key has been provisioned and no live OTP
round-trip has been performed. The OTP endpoints return a safe
"unavailable" response when unconfigured.

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

# 5. Data

Nine migrations, all applied cleanly to real PostgreSQL 16 in CI and
in local verification:

`20260928204500_add_application_user`,
`20260928213000_add_organizations_and_memberships`,
`20260929230000_add_organization_profile_fields`,
`20261001020000_add_members_and_memberships`,
`20261008230000_add_payments_and_audit_log`,
`20261009010000_add_member_otp_challenges`,
`20261009110000_add_member_sessions_and_phone_identity`,
`20261010103000_add_attendance_sessions`,
`20261011120000_add_payment_claims`.

# 6. Testing and CI (verified evidence)

CI (`.github/workflows/ci.yml`) has three jobs; run `38447698232` on
`57796bd1` completed **SUCCESS**:

- **build** (2m35s): install, Prisma generate + validate, lint,
  typecheck, Vitest, Playwright browser smoke tests, production
  build, docs consistency check.
- **db-tests** (1m29s): migrations applied to a disposable
  PostgreSQL 16, then the real-database suites via
  `scripts/run-db-tests.mjs`, which fails closed on any skip or
  failure.
- **e2e-auth** (2m14s): authenticated OWNER smoke test through the
  real Clerk sign-in path against a disposable database.

Verified counts at this baseline: Vitest **552 passed / 40 skipped**
(the 40 are exactly the database-gated tests, which run in the
db-tests job); `test:db` **57/57 passed, 0 skipped** on real
PostgreSQL 16; Playwright default suite **22 tests in 9 files**
(plus the separate e2e-auth smoke suite). History note: commit
`885569f` is a temporary CI diagnostic from the Playwright
troubleshooting period; it is superseded and inert — no revert is
required.

# 7. Deployment state

**Nothing is deployed anywhere.** The repository is
host-compatible (Procfile with release-phase
`prisma migrate deploy`, Node `20.x` engine pin, Prisma CLI in
production dependencies — commit `1803c9b8`) but no host, database,
domain, or environment has been provisioned. Hosting assessments
exist (Render recommended for production; Heroku student credit
assessed as zero-cost staging with material backup limits), but
**ADR 004 is still Proposed** — no hosting decision has been taken,
and no environment should hold real pilot data until backup and
restore requirements are satisfied.

# 8. Known launch blockers and outstanding work

Supported by current repository evidence unless marked otherwise:

1. **Hosting decision and provisioning** — ADR 004 unresolved; no
   production Clerk instance, domain, or environment variables exist
   outside CI.
2. **2Factor live verification** — account, API key (via secure
   configuration only), DLT registration, and one live OTP
   round-trip are all outstanding; until then member sign-in is
   unverified end to end.
3. **Backups and restore** — no backup schedule, restore drill, or
   off-platform copy exists for any future production database.
4. **Monitoring / error tracking** — ADR 007 still Proposed (Sentry
   the leading candidate); the codebase contains no error-tracking
   integration at all.
5. **Membership renewal — Not started.** No renewal flow exists;
   payments explicitly do not renew. A pilot gym's first plan expiry
   has no product path yet.
6. **PWA basics — Not started.** No `public/` directory, manifest,
   or icons exist.
7. **Gym switcher — Not started.** Staff and claims surfaces resolve
   the actor's primary (earliest) gym only; members can belong to
   multiple gyms but post-login gym selection is limited.
8. **Identity merge — Not started.** A person who is both staff and
   member temporarily has two user records by design (ADR 021).
9. **Owner dashboard** — the organization home is a link hub; no
   at-a-glance dues/expiry/attendance summary exists.
10. **SaaS billing/trial — Not started.** No subscription or trial
    mechanics for gyms.
11. **Documentation debt** — ADR 023 (staff management) and ADR 024
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
- CI runs on Node 20; GitHub has announced runner changes for
  Node 20 actions (informational annotation on current runs, no
  failures).

# 10. Next steps (each requires its own approval)

1. Decide hosting (resolve ADR 004) and provision a staging
   environment without real member data.
2. Provision the production Clerk instance and the 2Factor account;
   perform one live OTP round-trip.
3. Implement membership renewal.
4. Write ADR 023 and ADR 024; refresh this document after the
   deployment decision.
