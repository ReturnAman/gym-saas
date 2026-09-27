# Product Requirements Document

## Personas

- **Member** — works out at the gym; books classes, manages their membership.
- **Trainer** — runs classes and sessions; manages availability.
- **Manager** — front-desk/ops staff; handles members, bookings, check-ins.
- **Owner** — business KPIs: revenue, churn, utilization, staff.
- **Superadmin** — platform operator; manages gyms (tenants) and platform health.

## Functional requirements

### Authentication & accounts

- Email/password signup and login; password reset; email verification.
- Social login (Google, Apple) — v1.1 candidate.
- One user can belong to multiple gyms with different roles (member at gym A, trainer at gym B).
- Session management with secure, HttpOnly cookies or token rotation.

### Gym (tenant) management

- Superadmin creates gyms; owner configures profile, branding, timezone, currency.
- Staff invitation with roles (owner, manager, trainer).

### Plans & subscriptions

- Owner defines plans: name, billing interval, price, class credits or unlimited, trial days.
- Member purchases plan → subscription with states: `trialing`, `active`, `past_due`, `frozen`, `cancelled`, `expired`.
- Freeze (pause) with resume date; proration rules documented per plan.
- Dunning: automatic retries + member notifications on failed payments.

### Class scheduling & booking

- Trainers/managers create recurring and one-off classes: capacity, location/room, trainer, time window.
- Members browse schedule, book, cancel (within cancellation window), join waitlist.
- Automatic waitlist promotion on cancellations, with notification.
- Check-in via QR/code at the gym; no-show tracking.

### Trainer management

- Trainer profiles, specialties, availability windows.
- Session history and attendance counts (inputs to payroll reporting).

### Payments

- One-off and recurring billing through the payment provider; invoices/receipts.
- Refunds and credits handled by managers with an audit trail.
- No card data touches our servers (provider-hosted elements / tokens only).

### Notifications

- Email + push: booking confirmations, waitlist promotions, payment failures, class changes.
- Member notification preferences.

### Reporting (owner/manager)

- MRR, churn, new vs cancelled members, class utilization, attendance, revenue by plan.

## Non-functional requirements

| Category | Requirement |
| --- | --- |
| Performance | p95 API latency < 300 ms; booking flow < 30 s end-to-end |
| Availability | 99.9% monthly for booking/check-in; see `11-OBSERVABILITY.md` |
| Security | OWASP ASVS L2 baseline; tenant isolation; see `05-AUTHORIZATION.md`, `06-SECURITY.md` |
| Privacy | PII minimization, export/delete on request, regional data residency as required |
| Accessibility | WCAG 2.2 AA for member and dashboard surfaces |
| Offline | PWA: view schedule and bookings offline; queue mutations; see `08-PWA.md` |
| Scalability | Support 10k gyms / 1M members on the v1 architecture; see `12-SCALABILITY.md` |

## Open questions

- Cancellation/refund policy defaults per region.
- Whether class credits expire and rollover rules.
- Multi-location support timeline (currently out of v1 scope).
