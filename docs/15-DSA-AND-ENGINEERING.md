# DSA & Engineering Practices

Engineering standards for the team, plus the data-structures and algorithms
notes that actually matter for this domain.

## Code practices

- Small, reviewable PRs (< 400 lines changed); one concern per PR.
- Every PR: description of *why*, test plan, docs updated, changelog entry.
- Two reviewers for billing/auth code; one elsewhere.
- No `TODO` without a tracked issue; no commented-out code.
- Complexity budget: prefer boring, readable code over clever code.

## Domain-relevant DSA notes

- **Scheduling**: interval overlap detection for room/trainer conflicts (sweep line over sorted intervals); recurrence expansion done lazily with materialization windows.
- **Waitlists**: FIFO queues with stable ordering; promotion is a transactional pop with notification fan-out via the job queue.
- **Booking concurrency**: optimistic checks fail under bursts — use row-level locks / serializable transactions on the class row; load-test the burst path.
- **Search & filtering**: trigram/prefix indexes for member search; schedule queries are range scans on `(gym_id, starts_at)`.
- **Billing math**: money in integer minor units; rounding rules explicit and tested; proration computed server-side.
- **Rate limiting**: token bucket per key (member, IP, webhook source).

## Performance habits

- Measure before optimizing; add the benchmark to `docs/learning/`.
- N+1 queries are a CI failure (query-count assertions in integration tests).
- Pagination on every list endpoint; no unbounded queries.

## Learning culture

- Spikes and research notes go in `docs/learning/` with date and conclusion.
- Postmortems are blameless and filed there too.
