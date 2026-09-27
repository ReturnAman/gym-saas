# Current State

> Living document. Update whenever scope ships or decisions land.
> Last updated: 2026-09-27

## Snapshot

The repository scaffold and documentation baseline are in place. No
application code has been written yet; the tech stack is undecided.

## Decided

- Product scope v1 (charter, PRD, user flows) — `docs/00`–`docs/02`
- Architecture direction (draft, pending ADRs) — `docs/03`
- Data model conventions and core entities — `docs/04`
- RBAC model and permission matrix — `docs/05`
- Security baseline (OWASP ASVS L2) — `docs/06`
- API conventions and endpoint inventory — `docs/07`
- PWA strategy — `docs/08`
- Testing, DevOps, observability, scalability, cost frameworks — `docs/09`–`docs/13`
- ADR process defined — `docs/14`

## In progress

- [ ] Stack selection ADRs (language, framework, DB, hosting, payments)
- [ ] Repo creation on GitHub + CI verification

## Not started

- [ ] Auth + tenancy implementation
- [ ] Member / plan / subscription modules
- [ ] Class scheduling, booking, waitlists
- [ ] Trainer tooling, check-in
- [ ] Billing integration, dunning
- [ ] PWA shell, offline sync
- [ ] Reporting dashboards

## Next milestone

**Docs & architecture baseline → stack ADRs.** Pick the stack via ADRs in
`docs/decisions/`, then start with auth + tenancy.
