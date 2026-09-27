# Scalability

Target: 10,000 gyms, 1,000,000 members on the v1 architecture without redesign.

## Strategy

1. **Stateless API** — horizontal scaling behind a load balancer; sessions in shared store.
2. **Read scaling** — read replicas for reporting and schedule reads; cache hot schedules.
3. **Write scaling** — bookings are the hot write path: keep the transaction tight (single-row checks + row locks), avoid distributed transactions.
4. **Async by default** — emails, dunning, waitlist promotion, reports, and exports go through the job queue.
5. **Tenant-aware sharding plan** — shared DB now; shard key is `gym_id` if/when needed (kept clean by the tenancy convention in `04-DATABASE-DESIGN.md`).

## Caching

| What | Where | TTL |
| --- | --- | --- |
| Class schedules | Cache, per gym+day | Minutes; invalidated on class changes |
| Plan catalog | Cache, per gym | Hours; invalidated on plan edits |
| Session data | Shared session store | Session lifetime |

Never cache: bookings, subscription state, payment state.

## Hot spots & mitigations

- **Class release bursts** (many members booking at 06:00): queue booking requests per class, process FIFO, return `202` with status polling.
- **Reporting queries**: pre-aggregated daily snapshots per gym; heavy exports via background jobs.
- **Webhook floods**: idempotent handlers + bounded concurrency.

## Load testing

- Scenario suite in `tests/` (k6 or equivalent, TBD): burst bookings, schedule reads, checkout flow.
- Run against staging before each release; results stored in `docs/learning/`.

## Capacity planning

- Review monthly: p95 latencies, DB CPU/replica lag, queue depth, cache hit rates.
- Scaling triggers documented per component; autoscaling policies in IaC.
