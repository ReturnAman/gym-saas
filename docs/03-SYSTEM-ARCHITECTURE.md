# System Architecture

> Status: draft. Major choices to be ratified via ADRs (see `14-TECH-DECISIONS.md`).

## Context

Multi-tenant SaaS. Tenants are gyms. Clients: member PWA, staff/admin web
dashboard. One API serves both, plus webhooks from the payment provider.

## Component overview

```
            ┌─────────────┐        ┌─────────────┐
            │  Member PWA │        │ Admin/Staff │
            │  (mobile)   │        │  Dashboard  │
            └──────┬──────┘        └──────┬──────┘
                   │ HTTPS              │ HTTPS
                   ▼                    ▼
            ┌──────────────────────────────────┐
            │            API gateway           │  auth, rate limits,
            │        (REST, versioned)         │  tenant resolution
            └──────┬─────────────┬─────────────┘
                   │             │
        ┌──────────▼───┐   ┌─────▼────────┐
        │  Core domain │   │  Billing     │  subscriptions, dunning,
        │  services    │   │  service     │  provider webhooks
        └──────┬───────┘   └─────┬────────┘
               │                 │
        ┌──────▼─────────────────▼──────┐
        │        Primary database       │  tenant-scoped rows
        │        Cache (sessions,       │
        │        schedules)             │
        │        Job queue (emails,     │
        │        dunning, reports)      │
        └───────────────────────────────┘
                   ▲
        ┌──────────┴──────────┐
        │ Payment provider    │  Stripe (proposed) — hosted
        │ Email/push provider │  checkout, webhooks
        └─────────────────────┘
```

## Key decisions (proposed)

| Area | Proposal | Rationale |
| --- | --- | --- |
| Tenancy | Single database, tenant-id column on every row (+ row-level enforcement) | Cost-efficient at 10k-gym scale; strong isolation via tests + RLS |
| API style | REST, `/api/v1`, OpenAPI spec | Simplicity; see `07-API-SPECIFICATION.md` |
| Auth | Session cookies (web) + rotating refresh tokens (PWA) | XSS/CSRF posture; see `06-SECURITY.md` |
| Async work | Job queue for emails, dunning, waitlist promotion, reports | Keeps request paths fast; retries built in |
| File storage | Object storage for avatars, exports | — |

## Data flow highlights

- **Tenant resolution**: subdomain or `gym_id` claim → request context → all queries scoped.
- **Booking**: transactional — check capacity, credits, and double-booking atomically; enqueue confirmation.
- **Billing**: provider webhooks are the source of truth; idempotency keys on every mutation.

## Failure modes

- Payment provider down → queue retries; checkout shows maintenance state.
- Database failover → read-only degraded mode for schedule browsing; bookings paused with clear messaging.
- See `11-OBSERVABILITY.md` for detection and `12-SCALABILITY.md` for growth.

## Open ADRs

- [ ] ADR: tenancy model (shared DB + RLS vs schema-per-tenant)
- [ ] ADR: framework/language selection
- [ ] ADR: payment provider selection
- [ ] ADR: session vs JWT strategy
