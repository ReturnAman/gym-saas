# Gym SaaS

A multi-tenant SaaS platform for small and local gyms — member management,
memberships, attendance, payments, and a member-facing PWA, with an
operational dashboard for gym owners.

Gym owners are the paying customers; gym members are the primary daily users
of the member experience.

## What it does (planned V1)

- **Members & memberships** — add and manage members, membership plans,
  membership status, expiry tracking, and renewals.
- **Attendance** — QR-based member check-in, attendance history, active
  sessions, and occupancy derived from attendance.
- **Payments** — membership charges, member payment claims ("I have paid"),
  owner/staff verification of actual amounts received, partial payments,
  and system-calculated outstanding balances. Members pay the gym directly
  (UPI/QR configured per gym); the SaaS never holds gym membership money
  and V1 integrates no payment gateway.
- **Staff & roles** — staff management with role-based permissions
  (OWNER / ADMIN / TRAINER / STAFF / MEMBER), enforced server-side.
- **Announcements** — gym announcements visible to members.
- **Operational dashboard** — today's check-ins, occupancy, expiring
  memberships, outstanding payments, payment verification requests, and a
  Needs Attention list.
- **Member PWA** — installable mobile experience for check-in, attendance
  history, membership and payment status, announcements, and occupancy.

Out of scope for V1: class scheduling/booking, trainer payroll, payment
gateway integrations, and marketplace/social/workout-program features.
See `docs/17-PRODUCT-UX-SPEC.md` for the full product UX specification.

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

Prerequisites: Node.js 20+ and a PostgreSQL database.

```bash
git clone <repo-url> gym-saas
cd gym-saas
npm install

# 1. Configure environment
cp .env.example .env.local
# fill in DATABASE_URL (and later Clerk keys) — placeholders only in .env.example

# 2. Generate the Prisma client
npm run prisma:generate

# 3. Run the app
npm run dev          # http://localhost:3000
```

Useful commands:

```bash
npm test             # unit/application tests (Vitest)
npm run test:e2e     # browser smoke tests (Playwright, Chromium)
npm run lint         # ESLint
npm run typecheck    # TypeScript
npm run build        # production build (also runs prisma generate)
npm run prisma:validate   # validate prisma/schema.prisma
npm run prisma:migrate     # create/apply a migration (needs a real database)
npm run prisma:studio      # inspect the database
```

## Contributing

1. Read [AGENTS.md](AGENTS.md) for repo conventions.
2. Propose significant changes as an ADR in `docs/decisions/` first.
3. Open a PR using the pull request template; keep the [changelog](CHANGELOG.md) updated.

## License

TODO: choose a license.
