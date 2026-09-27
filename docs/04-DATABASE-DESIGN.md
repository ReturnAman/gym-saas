# Database Design

> Status: draft. Conventions are binding; the entity list grows with features.

## Conventions

- Every tenant-owned table has `gym_id` (UUID) — no exceptions.
- Primary keys: UUIDv7 (time-ordered). Foreign keys indexed.
- Audit columns on all tables: `created_at`, `updated_at`, `created_by`, `updated_by`.
- Soft delete (`deleted_at`) for member-facing records; hard delete only for PII on erasure request.
- Money: integer minor units + `currency` (ISO 4217). Timestamps: UTC.
- Enums as native DB enums or check constraints; documented in `docs/features/`.

## Core entities

```
gyms 1───* users (via gym_memberships: user ↔ gym, role)
  │
  ├───* plans ───* subscriptions ───* subscription_events
  │                    │
  │                    └───* invoices ───* payments
  │
  ├───* class_templates ───* classes ───* bookings ───* waitlist_entries
  │         │                   │
  │         └───* trainers ─────┘
  │
  └───* rooms, notifications, reports/snapshots
```

### Table sketches

- **gyms** — profile, timezone, currency, branding, settings JSON.
- **users** — identity (email, password hash, verified flags). Not tenant-scoped; linked via memberships.
- **gym_memberships** — `(user_id, gym_id, role)`; roles: `owner`, `manager`, `trainer`, `member`.
- **plans** — name, interval, price, credits or unlimited, trial days, policies JSON.
- **subscriptions** — `(gym_id, user_id, plan_id)`, status enum, billing anchors, freeze windows.
- **invoices / payments** — provider references, amounts, status, idempotency keys.
- **class_templates / classes** — recurrence rules materialized into concrete classes; capacity, room, trainer.
- **bookings** — `(class_id, user_id)`, status: `booked`, `checked_in`, `cancelled`, `no_show`.
- **waitlist_entries** — ordered queue per class with promotion state.

## Integrity rules

- Booking requires an atomic check: capacity, valid subscription/credits, no overlapping booking.
- Overlapping classes for the same room or trainer are rejected.
- Subscription state transitions are validated (state machine in code + check constraint).
- Webhook events are deduplicated by provider event id.

## Migrations

- Versioned, reversible migrations; run in CI and on deploy (`10-DEVOPS.md`).
- Backfill scripts live in `scripts/` and are idempotent.

## Indexing (initial)

- `(gym_id, ...)` composite indexes on hot paths: schedule lookup, member bookings, subscription status.
- See `12-SCALABILITY.md` for read-replica and partitioning plans.
