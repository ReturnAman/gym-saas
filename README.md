# Gym SaaS

A multi-tenant SaaS platform for gyms and fitness studios — memberships,
class scheduling and booking, trainer management, payments, and a member-facing
PWA, all under one roof.

## What it does

- **Memberships & plans** — sell plans, manage subscriptions, trials, freezes, and cancellations.
- **Class scheduling & booking** — trainers publish timetables; members book, join waitlists, and check in.
- **Trainer management** — trainer profiles, availability, payroll-relevant session tracking.
- **Payments** — subscriptions and one-off purchases via a PCI-safe payment provider integration.
- **Member PWA** — installable mobile app for booking, schedules, and membership self-service.
- **Admin dashboard** — per-gym analytics, member management, and staff tooling.

## Repository map

| Path | Purpose |
| --- | --- |
| `docs/` | Product and engineering documentation (start at `docs/00-PROJECT-CHARTER.md`) |
| `docs/features/` | One doc per feature |
| `docs/decisions/` | Architecture Decision Records (ADRs) |
| `docs/learning/` | Notes, spikes, and research |
| `design/` | Mockups, wireframes, design assets |
| `src/` | Application source code |
| `tests/` | Automated tests |
| `scripts/` | DevOps and maintenance scripts |
| `.github/` | CI workflows, issue and PR templates |

Key docs: [AI context](AI_CONTEXT.md) · [Agent operating manual](AGENTS.md) ·
[Changelog](CHANGELOG.md) · [Current state](docs/20-CURRENT-STATE.md)

## Quickstart

> The tech stack is not finalized yet — see
> [docs/14-TECH-DECISIONS.md](docs/14-TECH-DECISIONS.md) and
> [docs/20-CURRENT-STATE.md](docs/20-CURRENT-STATE.md). This section will grow
> as the first ADR lands.

```bash
git clone <repo-url> gym-saas
cd gym-saas
# TODO: add stack-specific setup once chosen
```

## Contributing

1. Read [AGENTS.md](AGENTS.md) for repo conventions.
2. Propose significant changes as an ADR in `docs/decisions/` first.
3. Open a PR using the pull request template; keep the [changelog](CHANGELOG.md) updated.

## License

TODO: choose a license.
