# Testing

## Pyramid

```
        ┌─────────┐  E2E: critical flows (signup→purchase→book→check-in)
        │   E2E   │  on staging, seeded data
        ├─────────┤
        │  Integ. │  API + DB: endpoints, webhooks, tenant isolation
        ├─────────┤
        │  Unit   │  Domain logic: pricing, state machines, scheduling rules
        └─────────┘
```

## Coverage & gates

- Unit + integration coverage ≥ 80% on `src/`; 100% on billing and authz paths.
- Mutation testing on the subscription state machine and booking transaction.
- CI runs: lint, typecheck, unit, integration (ephemeral DB), build. E2E on `main` and release branches.

## Mandatory test cases

- **Tenant isolation**: every new endpoint gets a cross-tenant read and write attempt (must 403/404).
- **Authz matrix**: each role × each capability from `05-AUTHORIZATION.md`.
- **Booking invariants**: no overbooking under concurrency (parallel booking attempts), no double-booking same member, credit deduction atomicity.
- **Billing**: webhook replay/idempotency, retry schedules, proration math, dunning transitions.
- **PWA**: offline booking queue, sync conflicts, installability (Lighthouse CI).

## Practices

- Test data via factories/fixtures, never production dumps.
- Contract tests for the OpenAPI spec (spec vs implementation drift fails CI).
- Load tests for booking bursts (class release at 06:00 scenario) — see `12-SCALABILITY.md`.
- Flaky test policy: quarantine, fix within one sprint, or delete.

## Tooling

TBD by stack ADR. Requirements: fast local runs, ephemeral test DB, parallel workers, clear failure output.
