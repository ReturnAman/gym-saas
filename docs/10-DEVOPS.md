# DevOps

## Environments

| Env | Purpose | Data |
| --- | --- | --- |
| local | Developer machines | Seeded fixtures |
| preview | Per-PR ephemeral | Seeded fixtures |
| staging | Pre-release verification, E2E | Production-like, anonymized |
| production | Live gyms | Real, backed up |

## CI/CD

- CI (`.github/workflows/ci.yml`): lint, typecheck, unit + integration tests, build, spec contract check.
- CD: `main` → staging automatically; production via manual approval + changelog check.
- Database migrations run as a separate deploy step with rollback plan; backward-compatible migrations only (expand → migrate → contract).
- Feature flags for risky rollouts (booking flow, billing changes).

## Infrastructure as code

- All infrastructure declared in code (tool TBD by ADR); no click-ops on production.
- Secrets in the managed secret store; injected as env vars; rotation runbook.

## Release process

1. PR merged to `main` → staging deploy + E2E.
2. `CHANGELOG.md` `Unreleased` section reviewed and curated.
3. Tag `vX.Y.Z` → production deploy with approval.
4. Post-deploy: smoke tests, error-budget check, announce in `#releases`.

## Backups & disaster recovery

- Automated DB backups (point-in-time recovery, tested restores monthly).
- RPO ≤ 1 h, RTO ≤ 4 h for production.
- Backup encryption and regional redundancy per compliance needs.

## Local development

- One-command bootstrap (`scripts/dev.sh` or equivalent once the stack lands).
- Seeded demo gym with plans, classes, and members for manual testing.
