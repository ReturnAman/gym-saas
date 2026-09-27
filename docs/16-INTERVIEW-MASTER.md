# Interview Master

A system-design interview study guide built on this project. If you can
whiteboard gym-saas end to end, you can whiteboard most SaaS problems.

## Core drills

1. **Design the booking system** — concurrency (10k members, one popular class),
   overbooking prevention, waitlist promotion. Key: row locks, idempotency keys,
   queue-based burst handling (`12-SCALABILITY.md`).
2. **Design multi-tenant SaaS** — tenancy models (silo/pool/bridge), isolation
   guarantees, noisy neighbors, per-tenant config (`03`, `04`).
3. **Design subscription billing** — state machine, dunning, webhooks,
   idempotency, reconciliation (`01`, `07`).
4. **Design the PWA offline sync** — conflict resolution, queueing, cache
   invalidation (`08`).
5. **Design notifications at scale** — fan-out, preferences, retries, provider
   failover (`01`, `11`).

## Question bank

- How do you prevent double-booking when two requests arrive in the same millisecond?
- Your payment webhook endpoint gets replayed 1000× — what breaks?
- A gym has 50k members; the owner opens the revenue report. How is it fast?
- How do you migrate tenants to a new schema with zero downtime?
- Design the check-in flow for a gym with no reliable internet at the front desk.

## Answer skeletons

For each drill: requirements → capacity estimation → API → data model →
deep dive (the hard part) → failure modes → trade-offs. Keep a worked example
in `docs/learning/` per drill.

## Rubric (self-assessment)

- [ ] States assumptions and asks clarifying questions first
- [ ] Identifies the single hardest sub-problem and goes deep there
- [ ] Discusses trade-offs, not just one "correct" answer
- [ ] Covers failure modes and monitoring, not just the happy path
