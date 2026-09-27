# Tech Decisions

Significant technical decisions are recorded as Architecture Decision Records
(ADRs) in `docs/decisions/`. This file defines the process.

## When to write an ADR

- Choice of language, framework, database, or hosting.
- Tenancy model, auth strategy, payment provider.
- Any decision that is expensive to reverse (data model, API versioning, encryption).

Trivial or easily reversible choices don't need one — note them in the PR.

## Format

File: `docs/decisions/NNNN-short-title.md` (zero-padded, sequential).

```markdown
# NNNN. Title

- Status: proposed | accepted | deprecated | superseded by NNNN
- Date: YYYY-MM-DD
- Deciders: ...

## Context
## Decision
## Consequences
## Alternatives considered
```

## Index

| ADR | Title | Status |
| --- | --- | --- |
| — | *(none yet — the first decisions are listed below)* | — |

## Pending decisions

1. Language & framework for the API
2. Frontend stack for PWA + dashboard
3. Primary database and tenancy enforcement (shared + RLS vs alternatives)
4. Payment provider
5. Hosting / IaC tooling
6. Session vs token auth strategy

Propose each as an ADR; do not start building on an undecided stack without
recording the choice (or an explicit spike in `docs/learning/`).
