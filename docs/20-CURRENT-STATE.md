
# 20 — CURRENT STATE

**Project:** gym-saas  
**Product:** TBD  
**Parent Company:** XYZ  
**Version:** 0.2  
**Status:** Implementation foundations established; product UX definition in progress  
**Last Updated:** 2026-10-01

---

# 1. Purpose

This document records the current implementation and decision state of the gym-saas project.

It is the operational snapshot of the repository.

AI tools and developers should read this document before starting meaningful work so they understand:

- what has already been decided
- what has been implemented
- what remains open
- what is currently being worked on
- what must not be changed without approval
- what the next engineering step is

This document should remain concise and current.

It is not a replacement for detailed architecture, security, product, database, or API documentation.

---

# 2. Current Project Status

## 2.1 Overall Status

The project has moved beyond pure documentation:

> **Engineering foundations implemented; product UX definition in progress**

Implemented foundations (see change log, section 39):

- Application foundation: Next.js 16 + TypeScript strict, Prisma 7 +
  PostgreSQL configuration, server-only env validation, Prisma client
  singleton, `GET /api/health`, Vitest + Playwright smoke tests, ESLint,
  CI workflow.
- Clerk authentication foundation: application `User` model, idempotent
  Clerk→User sync, protected `/app` route, `/sign-in` page.
- Organization and owner onboarding: `Organization` + `OrganizationMembership`
  models, owner onboarding flow creating the organization with the creator
  as OWNER.
- Gym profile and owner settings: editable gym profile fields
  (`/app/org/settings`), OWNER-only writes enforced server-side.
- Member Management V1 foundation (in working tree, uncommitted): `Member`
  + `Membership` models with migration, fixed four-plan V1 enum, calendar-
  month expiry derivation, exact-Decimal fee with paid ₹0 / outstanding = fee
  for new memberships; server-side validation, tenant isolation, and
  role-based authorization (OWNER/ADMIN/STAFF manage; TRAINER view;
  MEMBER own-only); routes `/app/org/members`, `/new`, `/[id]`,
  `/[id]/edit` with search, filters, pagination, live membership summary,
  duplicate-phone surfacing, and loading/empty/no-results/error states.
- Prisma/PostgreSQL setup with migrations, naming conventions, and CI
  validation (`prisma validate`, `prisma generate`).

Not yet implemented: import/WhatsApp migration, payment claims/verification,
attendance, dashboard, staff management, announcements, notifications,
production deployment. See section 34.

---

# 3. Documentation Status

| Document | Status |
|---|---|
| `AI_CONTEXT.md` | Complete |
| `AGENTS.md` | Complete |
| `00-PROJECT-CHARTER.md` | Complete |
| `01-PRODUCT-REQUIREMENTS.md` | Complete |
| `02-USER-FLOWS.md` | Complete |
| `03-SYSTEM-ARCHITECTURE.md` | Complete |
| `04-DATABASE-DESIGN.md` | Complete |
| `05-AUTHORIZATION.md` | Complete |
| `06-SECURITY.md` | Complete |
| `07-API-SPECIFICATION.md` | Complete |
| `08-PWA.md` | Complete |
| `09-TESTING.md` | Complete |
| `10-DEVOPS.md` | Complete |
| `11-OBSERVABILITY.md` | Complete |
| `12-SCALABILITY.md` | Complete |
| `13-COST-INFRASTRUCTURE.md` | Complete |
| `14-TECH-DECISIONS.md` | Complete |
| `15-DSA-AND-ENGINEERING.md` | Complete |
| `16-INTERVIEW-MASTER.md` | Complete |
| `17-PRODUCT-UX-SPEC.md` | Complete |
| `20-CURRENT-STATE.md` | Current document |

---

# 4. Product State

## 4.1 Product Direction

The first product is a gym management SaaS for small local gyms.

The primary paying customer is:

> Gym owner / gym operator

The primary daily end user is:

> Gym member

The product is intended to provide useful operational software to gyms while also creating a strong real-world software engineering project.

---

# 5. Core Product Scope

## 5.1 Owner Core

Planned V1 capabilities:

- Gym profile and settings
- Member management
- Membership management
- Payment tracking
- Payment verification
- Partial payments
- Attendance
- QR attendance
- Staff management
- Roles and permissions
- Dashboard
- Needs Attention
- Announcements
- CSV exports
- Basic occupancy information

---

## 5.2 Member Core

Planned V1 capabilities:

- OTP onboarding
- Gym QR-based entry
- Member home
- Check-in
- Attendance history
- Attendance percentage
- Membership status
- Payment status
- Renewal information
- Announcements
- Live occupancy

---

# 6. Future Product Scope

Potential future capabilities include:

- Attendance streaks
- Badges
- Consistency leaderboard
- Daily challenges
- Goals
- Achievement system
- Progress photos
- Gym-controlled challenges
- Partner offers
- Gym discovery
- Affiliate/commission functionality
- Additional engagement features

These are not required for initial implementation.

---

# 7. Architecture State

## 7.1 Application Architecture

Current architectural direction:

> Modular monolith

The initial system should not be split into microservices without a demonstrated need.

Business/domain logic should remain separated from presentation concerns.

---

## 7.2 Multi-Tenancy

Multi-tenancy is a core architectural requirement.

Each gym is represented as an organization/tenant.

The system must enforce tenant isolation on the backend.

Frontend organization checks are not considered a security boundary.

---

# 8. Technology Direction

Current technology direction:

### Frontend

- Next.js
- React
- TypeScript
- PWA

### Backend

- Next.js server-side/API capabilities initially
- Domain/business logic separated from UI

### Database

- PostgreSQL

### Authentication

- Clerk is the selected authentication provider (Accepted 2026-09-29; see `docs/decisions/001-AUTHENTICATION.md`)
- Clerk is responsible for authentication/identity only; authorization, organization membership, roles, and tenant isolation remain application-owned

### Authorization

Application-owned authorization.

Authentication and authorization remain separate concepts.

### ORM

Decided (2026-09-29): Prisma. See `docs/decisions/002-DATABASE-ORM.md` (Accepted).

---

# 9. Identity and Authentication State

## 9.1 User Identity

A user is an application-level identity.

Phone number is not the primary key.

A single user may belong to multiple organizations.

---

## 9.2 Member Authentication

Planned flow:

```text
Permanent Gym QR
        ↓
Identify Gym
        ↓
Enter Phone
        ↓
Check Gym Membership Association
        ↓
Send OTP
        ↓
Verify OTP
        ↓
Create / Link User
        ↓
Create / Confirm Organization Membership
        ↓
Access Gym
````

The QR code identifies the gym.

It does not authenticate the member.

OTP verification proves control of the phone number.

Authorization comes from organization membership and role.

---

## 9.3 Owner Authentication

Planned flow:

```text
Phone
 ↓
OTP
 ↓
User Account
 ↓
Minimal Gym Details
 ↓
Organization
 ↓
OWNER Membership
 ↓
Trial Subscription
```

Phone OTP does not by itself prove legal ownership of a gym.

---

# 10. Authorization State

Initial roles:

* OWNER
* ADMIN
* STAFF
* TRAINER
* MEMBER

Authorization must be enforced server-side.

Every protected operation should consider:

1. Is the user authenticated?
2. Which organization are they acting in?
3. What role do they have?
4. Do they have permission for this action?
5. Does the requested resource belong to the organization?
6. Is the requested state transition valid?

---

# 11. Subscription State

Initial owner trial:

> 7-day free trial

The exact initial member limit may remain configurable.

Trial expiration should not delete organization data.

Subscription state and organization state remain separate.

The planned entitlement model is:

```text
Subscription
     ↓
Plan
     ↓
Entitlements
     ↓
Feature / Action Checks
```

Avoid scattering direct checks such as:

```text
if trial
```

throughout the application.

---

# 12. SaaS Subscription Payment State

For V1:

> No Razorpay integration.

Gym owners pay the SaaS manually through supported payment methods such as:

* UPI
* Bank transfer

Payment is manually verified.

The subscription is then manually enabled or extended.

A future payment gateway can be added later if justified.

---

# 13. Member Payment State

The SaaS does not hold gym membership money.

The member pays the gym directly.

Possible methods:

* UPI
* Cash
* Card
* Other configured methods

The product records the gym's payment state.

---

## 13.1 Payment Claim

Member flow:

```text
View Amount Due
      ↓
View Gym UPI / QR
      ↓
Pay Gym
      ↓
"I Have Paid"
      ↓
Payment Claim
      ↓
Owner / Authorized Staff Verification
      ↓
Confirmed Payment
```

A payment claim is not a confirmed payment.

---

## 13.2 Partial Payments

Partial payments are supported.

Outstanding balance is calculated from actual confirmed payments.

Conceptually:

```text
Outstanding
=
Charge Total
-
Sum(Confirmed Payments)
```

Payment status may include:

* UNPAID
* PARTIALLY_PAID
* PAID
* OVERPAID

Payment and membership renewal remain separate domains.

---

# 14. Attendance State

Attendance is a core V1 feature.

Planned capabilities:

* QR check-in
* Check-in records
* Duplicate protection
* Attendance history
* Attendance percentage
* Active attendance sessions
* Occupancy calculation

---

# 15. Occupancy State

Live occupancy should be derived from active attendance/check-in sessions.

The system should avoid maintaining unnecessary duplicate occupancy state when it can be derived reliably.

Future occupancy analytics may include:

* historical occupancy
* peak hours
* occupancy trends

---

# 16. WhatsApp State

The planned production direction is:

> Centralized SaaS WhatsApp sender

The SaaS should not require every gym owner to manually configure their own WhatsApp infrastructure for the core notification system.

Messages remain personalized.

Example:

```text
Member Name
Gym Name
Amount
Membership Expiry
Reminder Type
```

Notification records must remain tenant-scoped.

---

## 16.1 Notification Architecture

Planned flow:

```text
Event
 ↓
Notification Rule
 ↓
Notification Job
 ↓
Queue
 ↓
Provider
 ↓
Delivery Status
```

The notification provider should be replaceable.

WhatsApp must not be used as the authentication system.

---

## 16.2 OpenWA

OpenWA may be useful for experimentation or controlled pilot testing.

It is not the production foundation for the commercial SaaS.

Production WhatsApp direction should use an appropriate official provider.

---

# 17. PWA State

The member and owner experiences are intended to work primarily as a Progressive Web App.

Initial goals:

* Installable
* Mobile-friendly
* Responsive
* Fast
* Good offline/error behavior
* QR-friendly
* App-like navigation

Native Android/iOS applications are not required for V1.

---

# 18. Security State

Security is a first-class requirement.

Important protected areas include:

* Authentication
* Authorization
* Tenant isolation
* OTP
* Payment state
* Member data
* Staff permissions
* QR flows
* API access
* Secrets
* Logs
* File uploads
* Notification data

The frontend must never be treated as a security boundary.

---

# 19. Database State

Database direction:

> PostgreSQL

Database design must support:

* Multi-tenancy
* Users
* Organization memberships
* Roles
* Members
* Memberships
* Plans
* Charges
* Payments
* Payment claims
* Attendance
* Attendance sessions
* Announcements
* Notifications
* Subscriptions
* Entitlements
* Audit information

Schema changes must use deliberate migrations.

Manual production schema modifications should be avoided.

---

# 20. API State

The API should:

* Authenticate requests
* Authorize requests
* Validate input
* Enforce tenant scope
* Validate resource ownership
* Enforce business rules
* Protect sensitive information
* Return predictable errors

The client must not be trusted to provide authoritative business state.

---

# 21. Testing State

Testing should cover at minimum:

### Authentication

* OTP expiration
* OTP attempts
* OTP cooldown
* OTP abuse protection
* Authentication failures

### Authorization

* Role restrictions
* Tenant isolation
* Resource ownership
* IDOR-style access attempts

### Payments

* Payment claims
* Payment confirmation
* Partial payments
* Outstanding balance
* Unauthorized confirmation
* Invalid payment amounts
* Payment state transitions

### Attendance

* Check-in
* Duplicate check-in
* Tenant isolation
* Attendance history
* Occupancy calculations

### General

* Unit tests
* Integration tests
* API tests
* End-to-end tests where valuable

---

# 22. DevOps State

The repository already has GitHub Actions/CI foundations.

The engineering workflow should use:

```text
Issue
 ↓
Implementation
 ↓
Tests
 ↓
Validation
 ↓
Commit
 ↓
Pull Request
 ↓
Review
 ↓
Merge
```

Production infrastructure should not be created prematurely.

---

# 23. Secrets State

Secrets must never be committed to Git.

Examples include:

* API keys
* Database credentials
* WhatsApp credentials
* Cloud credentials
* OAuth secrets
* Private tokens
* Production environment secrets

Use environment variables and appropriate secret-management mechanisms.

`.env.example` may contain variable names but never real secrets.

---

# 24. Observability State

The system should eventually provide:

* Structured logs
* Error tracking
* Health checks
* Request tracing where useful
* Notification delivery visibility
* Audit information for sensitive actions

Error tracking provider remains an open implementation decision.

---

# 25. Infrastructure State

The GitHub Student Developer Pack provides useful infrastructure benefits.

Potential resources include:

* Azure student credit
* MongoDB Atlas credits
* Heroku credit
* GitHub Pro
* GitHub Copilot
* Codespaces
* Other student benefits

These benefits should be used when they fit the architecture.

They should not drive architecture decisions merely because they are available.

---

# 26. Cost Philosophy

Initial goal:

> Minimize personal spending while building a real product.

Target initial personal infrastructure spend:

> Approximately ₹0–₹1,000/month where practical.

The architecture should allow the product to grow from low-cost development infrastructure toward paid production infrastructure without requiring unnecessary rewrites.

Paying customers should eventually fund production infrastructure.

---

# 27. Domain / Branding State

Final product name:

> TBD

Parent company:

> XYZ

Product brands are intended to be owned by the parent company.

Domain purchase should happen after the product/brand direction is sufficiently validated and before serious external pilot usage.

Do not purchase multiple domains prematurely.

---

# 28. Current Open Decisions

The following decisions remain open unless explicitly changed elsewhere:

* Final product name
* Final domain
* Production hosting
* Production PostgreSQL provider
* Error tracking provider
* Final API conventions
* API versioning strategy
* File storage provider
* Infrastructure-as-code approach
* Production WhatsApp provider
* Final notification provider configuration
* Exact pricing/plans
* Exact trial member limit
* Final entitlement matrix

Open decisions must not be silently finalized by AI tools.

---

# 29. Decisions Requiring Human Approval

Human approval is required before changing:

* Core architecture
* Database technology
* Authentication architecture
* Authorization model
* Tenant isolation model
* Payment architecture
* Payment gateway
* Production infrastructure
* Major third-party services
* Microservice architecture
* Security architecture
* Destructive database changes

AI tools may propose changes but must not silently make these decisions.

---

# 30. Current Engineering Rule

The project should not jump directly into building the entire SaaS.

Implementation should proceed incrementally.

Preferred workflow:

```text
Requirement
    ↓
Security Analysis
    ↓
Architecture / Data Impact
    ↓
Implementation Plan
    ↓
Human Approval if Required
    ↓
Implementation
    ↓
Tests
    ↓
Validation
    ↓
Diff Review
    ↓
Documentation Update
    ↓
Current-State Update
```

---

# 31. Current Development Philosophy

The developer is the engineer and architect.

AI tools are:

* implementation assistants
* reviewers
* debugging assistants
* learning assistants
* documentation assistants
* research assistants

AI must not become the unquestioned source of architectural decisions.

The repository remains the source of truth.

---

# 32. Git Strategy

Prefer small, focused commits.

Examples:

```text
docs: define member onboarding flow
docs: define payment architecture
docs: define authorization model
feat: add organization model
feat: add member creation flow
test: add tenant isolation coverage
fix: prevent duplicate attendance check-in
```

Avoid giant commits such as:

```text
build entire gym SaaS
```

---

# 33. Current Repository State

Expected repository structure:

```text
gym-saas/
├── README.md
├── AI_CONTEXT.md
├── AGENTS.md
├── CHANGELOG.md
│
├── docs/
│   ├── 00-PROJECT-CHARTER.md
│   ├── 01-PRODUCT-REQUIREMENTS.md
│   ├── 02-USER-FLOWS.md
│   ├── 03-SYSTEM-ARCHITECTURE.md
│   ├── 04-DATABASE-DESIGN.md
│   ├── 05-AUTHORIZATION.md
│   ├── 06-SECURITY.md
│   ├── 07-API-SPECIFICATION.md
│   ├── 08-PWA.md
│   ├── 09-TESTING.md
│   ├── 10-DEVOPS.md
│   ├── 11-OBSERVABILITY.md
│   ├── 12-SCALABILITY.md
│   ├── 13-COST-INFRASTRUCTURE.md
│   ├── 14-TECH-DECISIONS.md
│   ├── 15-DSA-AND-ENGINEERING.md
│   ├── 16-INTERVIEW-MASTER.md
│   ├── 17-PRODUCT-UX-SPEC.md
│   ├── 20-CURRENT-STATE.md
│   │
│   ├── features/
│   ├── decisions/
│   └── learning/
│
├── design/
├── src/
├── tests/
├── scripts/
│
└── .github/
    ├── workflows/
    ├── ISSUE_TEMPLATE/
    └── pull_request_template.md
```

---

# 34. What Has Not Started Yet

Unless separately recorded:

* Production database
* Production authentication
* Production deployment
* Production WhatsApp integration
* Payment gateway
* Production domain
* Full application implementation
* Production monitoring
* Real customer onboarding

These should be introduced deliberately.

---

# 35. Immediate Next Phase

The immediate product/engineering direction is:

```text
Product UX definition
    ↓
Approved screen design
    ↓
Vertical feature implementation
    ↓
Local product validation
    ↓
GitHub verification
```

Implementation proceeds one vertical slice at a time (member management is
the next candidate feature area), each following the workflow in section 30.
No feature work begins until its UX is defined and its screen design is
approved.

---

# 36. First Implementation Principle

Do not begin by building the dashboard UI.

The foundation should establish:

```text
Identity
   ↓
Organization
   ↓
Membership
   ↓
Authorization
   ↓
Domain Data
   ↓
Business Operations
   ↓
UI
```

This reduces the risk of building UI around incorrect authorization or data assumptions.

---

# 37. Current Priority

The immediate priority is:

> Define the product UX (`17-PRODUCT-UX-SPEC.md`), get screen designs
> approved, then implement the next vertical feature slice.

The engineering foundations (identity, organization, membership,
authorization primitives, database, CI) are established. Feature work now
builds upward from those foundations, one approved slice at a time.

---

# 38. Update Rules

Update this document when there is a meaningful change to:

* implementation status
* architecture
* major technology decisions
* security model
* production infrastructure
* major product scope
* important open decisions
* current development phase

Do not update it for every tiny code change.

---

# 39. Change Log

| Date       | Change                                 | Owner         |
| ---------- | -------------------------------------- | ------------- |
| YYYY-MM-DD | Initial current-state document created | Project Owner |
| 2026-09-29 | ORM finalized: Prisma (ADR 002 Accepted); stale ORM references updated | Project Owner |
| 2026-09-29 | Authentication provider finalized: Clerk (ADR 001 Accepted; ADR 015 Accepted) | Project Owner |
| 2026-09-29 | Testing stack finalized: Vitest + Playwright (ADR 003 Accepted) | Project Owner |
| 2026-09-29 | Application foundation established: Next.js 16 + TypeScript + Prisma 7 + PostgreSQL config, env validation, Prisma client singleton, health endpoint, Vitest + Playwright smoke tests, CI workflow | Project Owner |
| 2026-09-29 | Clerk authentication foundation: application User model, idempotent Clerk→User sync, protected `/app`, `/sign-in` page | Project Owner |
| 2026-09-29 | Organization + owner onboarding: Organization/OrganizationMembership models, onboarding flow, creator becomes OWNER | Project Owner |
| 2026-09-30 | Gym profile and owner settings: editable organization profile (`/app/org/settings`), server-side OWNER enforcement | Project Owner |
| 2026-10-01 | Member Management V1 UX finalized in `docs/17-PRODUCT-UX-SPEC.md`: migration-first assumption, manual add member (`/app/org/members/new`) with membership summary, import members (CSV/Excel/image/scan/PDF at UX level), human-review extraction flow, data-quality and duplicate-review rules, member list/details/edit routes and states | Project Owner |
| 2026-10-01 | Member Management V1 UX amended in `docs/17-PRODUCT-UX-SPEC.md`: WhatsApp-based migration path added as a first-class option ("Send on WhatsApp" in Add Members entry); unified import inbox / migration job concept (all sources → extraction → validation → mandatory human review → confirmation → creation); "submission received" distinguished from "members imported"; new TBDs 18–21 (WhatsApp receiving approach, gym association mechanism, media support, early-rollout operations). Specification only — no implementation claims | Project Owner |
| 2026-10-01 | Member Management V1 visual design specification added as `docs/17-PRODUCT-UX-SPEC.md` §20.1: implementation-ready screen spec for all ten screens (members list desktop+mobile with five states, Add Members three-choice step, manual add with live membership summary, import entry, processing states, import review, duplicate review, WhatsApp handoff, member details, edit member) plus shared visual language and Figma frame checklist. No product decisions changed; no repo Figma workflow exists, so the spec lives in the UX document. Design preparation only — no implementation claims | Project Owner |
| 2026-10-01 | Member Management V1 first vertical slice implemented (uncommitted, working tree): `Member` + `Membership` Prisma models and migration `20261001020000_add_members_and_memberships` (fixed V1 plan enum, calendar-month expiry, Decimal fee, no persisted paid amount — Paid = ₹0 / Outstanding = Fee as domain-derived values; composite FK `memberships(organization_id, member_id)` → `members(organization_id, id)` enforcing member/membership organization match at the database level); pure domain module (`src/lib/members.ts`) and server service (`src/lib/server/members.ts`) with validation, tenant isolation, and role-based authorization; routes `/app/org/members`, `/new`, `/[id]`, `/[id]/edit` with search/filters/pagination, live summary, duplicate-phone surfacing, and full state coverage; 58 new tests (105 total) green; lint/typecheck/build green. No import/OCR/WhatsApp/payment/attendance systems built | Project Owner |
| 2026-10-01 | Member Management V1 corrections (uncommitted, working tree): removed `Membership.paid_amount` per the finalized payment architecture (Outstanding = charge − SUM(confirmed payments); payment claims/confirmations are a later slice, no payment tables created); added database-level tenant integrity via composite unique `members(organization_id, id)` + composite FK, with migration-coherence tests and an opt-in real-database enforcement test (`RUN_DB_TESTS=true`) | Project Owner |

---

# 40. Final Rule

This document describes the current state.

If the implementation differs from this document, the difference must be investigated.

Do not silently assume that the documentation is wrong.

Do not silently change architecture to match an AI-generated assumption.

Surface the discrepancy, determine the intended state, and update the appropriate source-of-truth document.

---
```
