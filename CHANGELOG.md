# Changelog

All notable changes to this project are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added
- Member Management V1 first vertical slice (uncommitted, working tree):
  `Member` + `Membership` Prisma models with migration
  `20261001020000_add_members_and_memberships` (fixed four-plan V1 enum,
  calendar-month expiry derivation, exact Decimal fee, no persisted paid
  amount — paid is always ₹0 / outstanding is the full fee as
  domain-derived values per the finalized payment architecture, and a
  composite foreign key enforces that a membership's organization always
  matches its member's organization at the database level); pure domain module (`src/lib/members.ts`) shared by client and server;
  server service (`src/lib/server/members.ts`) with server-side validation,
  tenant isolation, duplicate-phone surfacing, and role-based authorization
  per the V1 permission matrix (OWNER/ADMIN/STAFF manage, TRAINER view,
  MEMBER own-only); routes `/app/org/members` (search, filters, pagination,
  loading/empty/no-results/error states), `/app/org/members/new` (live
  membership summary, no default start date, idempotent submit),
  `/app/org/members/[id]` (Member/Membership/Financial sections plus an
  attendance placeholder), and `/app/org/members/[id]/edit`
  (identity/contact only — membership terms never rewritten); import and
  WhatsApp remain clearly-marked unavailable entry points. 58 new tests
  (105 total) green; ESLint, typecheck, and production build green.
- Product UX specification (`docs/17-PRODUCT-UX-SPEC.md`): product UX
  principles, user types, product areas, information architecture,
  navigation model, V1 screen inventory (owner console + member PWA),
  dashboard/members/member-details UX, forms and state principles,
  responsive behavior, permission UX, payment UX (claim vs. confirmed),
  notification/WhatsApp UX, accessibility baseline, Figma handoff
  principles, V1/V1.5/Later scope, and open UX decisions (TBDs).
- Current-state alignment: `docs/20-CURRENT-STATE.md` now reflects the
  implemented engineering foundations (auth, org onboarding/settings,
  Prisma/PostgreSQL, tests, CI) and sets the direction to product UX
  definition → approved screen design → vertical feature implementation →
  local product validation → GitHub verification.
- README product description aligned with the approved focused direction
  (members, memberships, attendance, payments, staff/roles, announcements,
  operational dashboard, member PWA); removed unplanned V1 claims
  (class booking, trainer payroll, payment-provider integration).
- Initial repository scaffold: documentation suite (`docs/00`–`docs/20`),
  agent operating manual (`AGENTS.md`), AI context (`AI_CONTEXT.md`), CI
  workflow, and issue/PR templates.
- Application foundation: Next.js 16 + TypeScript (Turbopack), Prisma 7 +
  PostgreSQL shell, server-only env validation and Prisma client,
  `GET /api/health`, Vitest + Playwright smoke tests, ESLint, CI workflow.
- Prisma database foundation: schema naming conventions (snake_case via
  `@map`/`@@map`, UUID PKs, UTC `created_at`/`updated_at`, Decimal money,
  UPPERCASE enums) per ADRs 002/011/012/013.
- Clerk authentication foundation: official `@clerk/nextjs` integration
  (proxy-based auth context, `ClerkProvider`, minimal `/sign-in` page),
  application `User` model (`users` table: opaque UUID PK, unique
  `clerk_user_id`, `created_at`/`updated_at` timestamptz) with migration
  `20260928204500_add_application_user`, idempotent Clerk→User
  synchronization (`getCurrentUser` / `requireCurrentUser`, server-only),
  and a minimal protected `/app` page enforcing authentication
  server-side. Clerk keys are required env vars
  (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`).
- Gym profile and owner settings: nullable `phone`, `email`, `address`
  fields on `Organization` with migration
  `20260929230000_add_organization_profile_fields`; server-side
  `updateOrganizationProfile` (organization resolved from the caller's own
  membership — no organization ID accepted — OWNER role enforced
  server-side, input validated, only allow-listed fields written) exposed
  through the `updateOrganizationProfileAction` server action with
  field-level validation feedback and a success state; pure validation
  module (`src/lib/organization-profile.ts`) shared with the client form;
  minimal protected settings page (`/app/org/settings`): editable form for
  the OWNER, read-only profile view for other members; link from `/app/org`.
  Unknown failures return a generic message (no internals leaked).
- Organization and owner onboarding foundation: `Organization` and
  `OrganizationMembership` models (`organizations` and
  `organization_memberships` tables: UUID PKs, `Role` enum
  `OWNER/ADMIN/TRAINER/STAFF/MEMBER`, unique constraint on
  `(user_id, organization_id)` preventing duplicate memberships, FKs with
  cascade) with migration
  `20260928213000_add_organizations_and_memberships`; server-side
  authorization layer (`src/lib/server/authorization.ts`: membership lookup,
  `requireOrganizationMembership`, `hasRole`, `requireOrganizationContext`
  — organization derived from server-side membership data only); atomic
  organization creation (`createOrganization`: single `$transaction` creating
  the `Organization` plus the creator's `OWNER` membership) exposed through
  the `createOrganizationAction` server action; minimal protected
  onboarding page (`/onboarding`: gym-name form, never shown again once the
  user belongs to an organization) and protected organization page
  (`/app/org`: displays the gym name); `/app` routes first-time users to
  onboarding and members to their organization area. Unauthenticated
  requests to `/app`, `/onboarding`, and `/app/org` redirect to `/sign-in`.

### Fixed
- CI: run `npm run prisma:generate` in the GitHub Actions workflow before
  typecheck. A fresh `npm ci` does not produce the generated Prisma client
  (`node_modules/.prisma/client`), so `tsc --noEmit` failed on every commit
  with `TS2305` (`@prisma/client` has no exported member ...) at the
  Typecheck step.
- CI: Playwright uses `http://127.0.0.1:3000` as the test origin.
- CI: Playwright launches full Chromium via `channel: "chromium"` instead of
  the bundled headless shell.

## [0.0.0] - 2026-09-27

### Added
- Repository created.
