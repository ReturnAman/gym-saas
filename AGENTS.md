# AGENTS.md — gym-saas

Operating manual for AI agents working in this repo. The project-level
instructions cover how you work in general; this file covers how you work
*here*.

## Before you change anything

1. Read `AI_CONTEXT.md` and `docs/20-CURRENT-STATE.md`.
2. Check `docs/decisions/` for ADRs covering your area — follow them; if you disagree, write a new ADR rather than silently diverging.
3. For product behavior, consult `docs/01-PRODUCT-REQUIREMENTS.md` and `docs/02-USER-FLOWS.md`.

## Conventions

- **Docs-first**: behavior changes update the relevant `docs/` file in the same PR.
- **ADRs**: significant technical decisions get a record in `docs/decisions/` named `NNNN-short-title.md` (see `docs/14-TECH-DECISIONS.md`).
- **Changelog**: user-facing changes get an entry under `Unreleased` in `CHANGELOG.md`.
- **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
- **Branches**: `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`; PRs target `main`.
- **Tenant safety**: every data access path must be scoped to the current gym (tenant). Add a test proving cross-tenant isolation for new endpoints.
- **No secrets in repo**: env vars + secret manager only. Never log PII or payment data.
- **Tests**: follow `docs/09-TESTING.md`; new features ship with unit + integration tests.

## Definition of done

- [ ] Code + tests, all green (`scripts/` or CI)
- [ ] Docs updated (`docs/`, `CHANGELOG.md`, `docs/20-CURRENT-STATE.md` if scope changed)
- [ ] ADR written if the change is a significant technical decision
- [ ] No hardcoded secrets; tenant scoping verified
- [ ] PR uses the repo template and passes CI

## Lessons learned

- _(append durable, repo-specific lessons here as they emerge)_
