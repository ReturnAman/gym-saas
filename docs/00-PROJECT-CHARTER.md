# Project Charter

## Vision

Become the operating system for independent gyms and fitness studios —
one platform for members, trainers, and owners instead of a patchwork of
spreadsheets, booking tools, and payment links.

## Problem

Independent gyms lose members and staff hours to fragmented tooling:
membership tracking in spreadsheets, class bookings over WhatsApp,
payments through disconnected links, and no reliable attendance or revenue
reporting.

## Objectives

1. Give gym owners a single dashboard for members, plans, classes, trainers, and revenue.
2. Give members a fast, installable mobile experience for booking and self-service.
3. Give trainers simple tools for schedules, rosters, and session history.
4. Automate the billing lifecycle (trials, renewals, dunning, freezes) to cut churn and admin work.

## Scope — in

- Multi-tenant gym management (members, plans, subscriptions)
- Class scheduling, booking, waitlists, check-in
- Trainer profiles, availability, session tracking
- Payments and subscription billing integration
- Member PWA; admin/staff web dashboard
- Reporting and analytics per gym

## Scope — out (v1)

- Native iOS/Android apps (PWA first)
- POS / retail inventory
- Nutrition planning and workout programming
- Franchise / multi-location hierarchies beyond single gyms (revisit post-v1)

## Stakeholders

| Stakeholder | Interest |
| --- | --- |
| Gym owners / managers | Run the business, see revenue and retention |
| Trainers | Manage schedules and client sessions |
| Members | Book classes, manage membership |
| Platform team | Operate the SaaS reliably and securely |

## Success criteria (v1)

- A gym can onboard, configure plans, and take its first paying member without support.
- Booking a class takes a member under 30 seconds on a mid-range phone.
- Billing runs (renewals, retries, dunning) need zero manual intervention in the happy path.
- 99.9% monthly availability of the booking and check-in paths.

## Risks

| Risk | Mitigation |
| --- | --- |
| Payment integration complexity / PCI scope | Use a certified provider (e.g. Stripe), never touch card data |
| Multi-tenant data leakage | Tenant scoping enforced at the data layer + isolation tests |
| PWA adoption friction | Clear install prompts; core flows work in the browser too |
| Scope creep into programming/POS | Charter exclusions; feature requests go through PRD review |

## Milestones

1. Docs & architecture baseline (this suite)
2. Auth + tenancy + member CRUD
3. Plans, subscriptions, payments
4. Class scheduling, booking, waitlists
5. Trainer tooling + check-in
6. PWA packaging + offline
7. Beta with pilot gyms
