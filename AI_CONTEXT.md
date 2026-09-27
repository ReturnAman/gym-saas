# AI Context — gym-saas

This file orients AI assistants working in this repository. Read it before
making changes.

## Project in one paragraph

Gym SaaS is a multi-tenant SaaS for gyms and fitness studios. Gym owners run
their business (members, plans, classes, trainers, payments) from an admin
dashboard; members book classes and manage memberships through an installable
PWA. Tenancy is per-gym: every gym's data is isolated, with a platform-level
superadmin for operations.

## Source of truth

- Product intent: `docs/00-PROJECT-CHARTER.md`, `docs/01-PRODUCT-REQUIREMENTS.md`
- How it should be built: `docs/03-SYSTEM-ARCHITECTURE.md` through `docs/13-COST-INFRASTRUCTURE.md`
- What's actually built: `docs/20-CURRENT-STATE.md` (update it when you ship)
- Decisions: `docs/decisions/` (ADRs) — check here before re-litigating a choice
- Conventions for agents: `AGENTS.md` (this repo's operating manual)

## Working conventions

- Docs-first: update the relevant `docs/` file when behavior changes; don't let docs rot.
- Significant technical choices get an ADR in `docs/decisions/` (see `docs/14-TECH-DECISIONS.md`).
- Every user-facing change updates `CHANGELOG.md` under `Unreleased`.
- Never commit secrets; use environment variables and a secret manager.
- Multi-tenancy is a hard requirement — every query path must be tenant-scoped.

## Current stack

Not finalized. See `docs/20-CURRENT-STATE.md` for status and
`docs/14-TECH-DECISIONS.md` for the decision process. Do not assume a
framework, language, or database — propose via ADR.

## Glossary

- **Tenant / gym**: one gym or studio; the unit of data isolation and billing.
- **Member**: end user with a membership at a gym.
- **Plan**: a sellable membership product (e.g. monthly unlimited).
- **Subscription**: a member's enrollment in a plan, with billing lifecycle.
- **Class / session**: a bookable trainer-led activity; **booking** reserves a spot.
