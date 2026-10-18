# ADR 004 — Hosting and Infrastructure

**Project:** gym-saas
**Status:** Proposed — awaiting owner approval
**Date:** 2026-10-18
**Decision Type:** Infrastructure / Architecture / Cost

> This revision (2026-10-18) completes the provider evaluation the
> original ADR 004 required before final selection (its §37:
> pricing and capabilities verified from official provider
> documentation). Its binding requirements are carried into §2;
> citations of the form "original §N" refer to that original text.
> All prices and capabilities below were verified from official
> vendor documentation on 2026-10-18 (first verified 2026-10-14/15;
> changes since then are called out in §10). Status remains
> Proposed: no provider is selected until the owner approves §9.

---

# 1. Status

Proposed — awaiting owner approval. Nothing in this document has been
provisioned, purchased, or deployed.

# 2. Context and constraints

gym-saas is a multi-tenant gym-management SaaS: Next.js 16 + TypeScript
modular monolith, Prisma 7 over PostgreSQL (12 migrations, verified
against PostgreSQL 16), Clerk for owner/staff authentication, 2Factor
SMS OTP for members (live path not yet verified). The repository is
already host-portable: a Procfile maps the release phase to
`npx prisma migrate deploy`, Node is pinned to `20.x`, and the Prisma
CLI ships in production dependencies.

Binding constraints carried from the existing ADR 004 requirements and
the project's engineering standards:

- Managed PostgreSQL only; no self-managed database server initially
  (original §9–§10).
- Automated backups, and **recovery testing before the product depends
  on production data** (original §20). A backup that has never been
  restored is not assumed reliable.
- The database layer is sized for a small connection allowance: the
  application pool is pinned at `max` 8 (H1), so the whole deployment
  needs roughly 12 connections (web 8 + release/migrations ~2 + ops ~2).
- Target initial spend is ₹0–1,000/month *where practical* — a target,
  not a hard constraint; security and reliability take priority
  (original §29).
- Initial scale is a single-gym pilot growing to perhaps 10–20 gyms /
  1,500–3,000 members; simplicity and reliability over theoretical scale.
- No Redis, queues, microservices, or multi-region deployment initially
  (original §33). GitHub Actions CI already exists and stays the CI.
- Gyms and members are in India. **None of Render, Railway, or Heroku
  offers an India region** on the tiers considered (verified §10);
  Singapore is the nearest region on Render and Railway, and Heroku's
  Common Runtime is US/EU only. No general data-localization
  requirement has been identified for this category of data under
  India's DPDP Act; sector-specific regimes have not been assessed
  (the app records payments but does not itself process card or
  payment-system data). Residency is therefore treated here as an
  owner preference and latency question, not a legal blocker
  identified here (not legal advice — the owner may want
  independent confirmation).
- File storage (original §22) and background jobs (original §23)
  remain open decisions and are out of scope for this hosting
  decision; the §5 estimate assumes no object storage and no
  background workers.

# 3. Options considered

Three realistic architectures were evaluated. A VPS/self-managed
PostgreSQL option is excluded by the constraints above; Vercel +
separate Postgres splits the application across two vendors and bills
serverless execution per use, which fits this always-on,
connection-pinned workload worse than a single platform — it is not
carried into the comparison.

## 3.1 Render (web service + managed PostgreSQL, Singapore)

- Next.js runs as a standard Node web service; pre-deploy command
  (`prisma migrate deploy`) is officially supported on paid web
  services and a failure fails the deploy.
- PostgreSQL: smallest paid instance (Basic-256mb, 256 MB RAM) allows
  **100 connections** — far above the ~12 budget. PITR is included on
  all paid databases with a **3-day recovery window on a Hobby
  workspace (7 days on Pro)**; logical exports can be created on
  demand and are retained seven days after creation — they are
  not scheduled automatically.
- Flat, predictable pricing; custom domains with automatically
  provisioned/renewed TLS; secrets as dashboard environment variables;
  built-in logs and metrics.
- Free tiers are unsuitable for a pilot (web spins down after
  15 minutes idle; free Postgres expires after 30 days).

## 3.2 Railway (web service + PostgreSQL, Singapore `asia-southeast1-eqsg3a`)

- Pre-deploy command is now verified as officially supported (runs
  between build and deploy; failure halts the deployment) — this was
  unverified in the October 15 comparison.
- PostgreSQL PITR via pgBackRest continuous WAL archiving is opt-in,
  with weekly full + daily differential backups and a **~4-week restore
  window** — the strongest recovery window of the three — restoring to
  a *new* service beside the source; no separate PITR fee.
- Metered pricing (Hobby $5/mo + usage) makes the monthly bill an
  estimate, not a flat figure.
- **Decisive unknown:** Railway's official documentation states no
  plan gate for PITR or the Singapore region, but multiple independent
  reports say the dashboard requires the **Pro plan ($20/mo)** for
  volume backups/PITR. This cannot be settled from documentation; it
  needs a no-spend check in the Railway dashboard. If Pro is required,
  Railway's floor is ~$20/mo before usage and it loses on cost.

## 3.3 Heroku (Basic dyno + Heroku Postgres Essential, US/EU)

- The repository is already Heroku-compatible (Procfile release phase),
  and the GitHub Student offer ($13/mo for 24 months) would cover the
  ~$12/mo stack for about two years.
- Essential-0 Postgres ($5/mo) allows only **20 connections** — workable
  against the ~12 budget but with little headroom — and provides **no
  point-in-time recovery**: rollbacks/PITR exist only on Standard tier
  or higher. Essential keeps daily logical backups (retained 7 days,
  plus 1 weekly), so a restore can lose **up to ~24 hours** of records —
  including payment records. Heroku documents that scheduled
  PGBackups failures generate no notifications — they must be
  checked manually.
- US/EU regions only on these tiers (worst latency of the three for
  Indian users).

## 3.4 Comparison

| Criterion | Render | Railway | Heroku |
| --- | --- | --- | --- |
| Pilot shape | Starter-class web + Basic-256mb PG, Singapore | Web + PG, Singapore | Basic dyno + Essential-0 PG, US/EU |
| Monthly cost (est., §5) | ~₹1,264–1,378 flat | ~₹950–1,615 metered on Hobby *if* Hobby suffices; ₹1,900+ if Pro required | ~₹1,140; ~₹0 out-of-pocket under student credit |
| India region | None (Singapore nearest) | None (Singapore nearest) | None (US/EU only) |
| PG connections | 100 | ~100 (third-party reports; not officially confirmed) | 20 (Essential-0) |
| PITR | Yes — 3-day window (Hobby ws) / 7-day (Pro ws) | Yes — ~4-week window, opt-in | **No** on Essential (Standard+ only) |
| Backup cadence/retention | Continuous (PITR); on-demand logical exports retained 7 days after creation | Weekly full + daily differential, ~4 weeks | Daily logical, 7-day retention + 1 weekly |
| Restore shape | PITR to a point within window | Restore creates a new PG service | Restore from daily backup (≤ ~24 h data loss) |
| Pre-deploy migrations | Supported; failure fails deploy | Supported; failure halts deploy | Procfile release phase (already in repo) |
| Secrets/env separation | Dashboard env vars per service | Service variables per environment | Config vars per app |
| Custom domain + HTTPS | Included; automatic TLS | Included; automatic TLS | Included on paid dynos; automatic TLS |
| Logs/monitoring | Built-in logs/metrics; external error tracking separate (ADR 007) | Built-in logs/metrics | Built-in logs; add-ons for more |
| Pricing model | Flat per instance | Metered (RAM/CPU/volume/egress) | Flat per dyno/plan |
| Lock-in | Low — standard PG, portable Next.js | Low — standard PG | Low–moderate — platform conventions (Procfile already abstracted) |
| Operational complexity | Lowest of the three at this scale | Low; metered cost needs watching | Lowest operationally, weakest recovery |

# 4. Recommended architecture

**Adopt Render (Singapore) for the pilot**, in two gated stages:

- **Stage 0 — staging (synthetic data only):** Hobby workspace ($0),
  one paid web service (Starter class, 512 MB), smallest paid
  PostgreSQL (Basic-256mb) in Singapore; build `npm run build`, start
  `npm start`, pre-deploy `npx prisma migrate deploy`; reuse the
  existing CI Clerk *development* instance; `TWOFACTOR_API_KEY` unset
  initially (member OTP returns 503; the app boots and staff flows
  work); a free external uptime ping on `/api/health`.
  **Exit criterion: a timed PITR restore drill** (§6) must pass before
  any real data is considered.
- **Pilot (first real gym):** same shape, plus a production Clerk
  instance and keys, a 2Factor account + API key with one verified
  live OTP round-trip, and a custom domain. Workspace moves to Pro
  ($25/mo) only if the 7-day PITR window or other Pro features are
  wanted — not required for the pilot.

Why Render: it is the only option that is simultaneously flat-priced
inside a predictable band, PITR-capable at the entry tier, generous on
connections (100 vs a ~12 budget), Singapore-hosted, and fully verified
from official documentation — every load-bearing figure in §3.1 is
sourced, whereas Railway's best case depends on an unverified plan
gate and Heroku's recovery posture (no PITR, up to ~24 h loss) is a
poor fit for payment records.

Railway remains the documented fallback: if the owner runs the
no-spend dashboard check and Hobby *does* allow PITR + Singapore,
Railway's ~4-week recovery window is genuinely better and the
decision can be revisited before provisioning. Heroku remains viable
only if the owner formally accepts the ~24 h recovery-point exposure
in this ADR — recommended against.

# 5. Cost estimate and assumptions

Rate: **USD/INR 95.01** (verified 2026-10-18). Assumptions: one
always-on small web instance; Postgres data ≤ 5 GB; low egress
(single-gym pilot → a few gyms); no background workers; GitHub Actions
on the existing plan; error tracking on a free tier initially
(ADR 007 is a separate decision).

| Option | USD/mo | INR/mo (approx.) | Notes |
| --- | --- | --- | --- |
| Render (recommended) | $13.30–14.50 | **₹1,264–1,378** | $7 web + $6 PG compute + PG storage at $0.30/GB/mo (1 GB minimum; up to 5 GB within this range) |
| Railway on Hobby (if sufficient) | ~$10–17 | ~₹950–1,615 | $5 plan + metered usage for an always-on small service; estimate, not a cap |
| Railway if Pro required | $20+ usage | ₹1,900+ | Floor before usage |
| Heroku | $12 | ~₹1,140 | $7 Basic + $5 Essential-0; student credit $312 ≈ 24 months at $13/mo, Heroku products only, card required, no rollover |

**Included:** web hosting, managed Postgres, TLS, the platform
features in §3.4. **Excluded:** domain registration (~₹800–1,200/yr
when purchased), 2Factor SMS charges (per-message, usage-dependent,
billed by 2Factor), any paid error-tracking tier, bandwidth beyond
plan allowances (Render meters bandwidth), taxes and card
currency-conversion charges on USD billing, the owner's time.
The Render figure exceeds the ₹0–1,000 target in original §29; that
target explicitly yields to reliability requirements, and no verified
option with PITR lands under it (Heroku is cheaper only by giving up
PITR; Railway only if the unverified Hobby assumption holds).

# 6. Security, backups, and disaster recovery

- **Secrets:** only in the provider's environment mechanism — never in
  the repository (original §17). Production Clerk keys and
  `TWOFACTOR_API_KEY` are provisioned through the secure flow at
  deploy time; staging and production use separate services, separate
  databases, and separate Clerk instances. Production access is
  limited to the owner.
- **Backups (Render, recommended):** PITR with a 3-day window on the
  Hobby workspace (7 days on Pro), plus logical exports, which are
  created on demand (not scheduled) and retained seven days after
  creation. PITR is the primary recovery mechanism. The newest
  restorable point trails real time by at least ~10 minutes —
  Render does not allow a restore target within ten minutes of the
  current time — so the effective recovery point is minutes-scale,
  not zero; recovery time is dominated by instance provisioning +
  restore + verification — to be measured by the drill, not assumed.
- **Restore drill (mandatory before real data, per original §20):**
  restore the staging database to a point 1 hour in the past onto a
  parallel instance; boot the app against it; verify row counts on
  members/payments and a staff sign-in; record elapsed time. Repeat
  after any provider/plan change and at least quarterly during the
  pilot. **No backup or drill exists yet; nothing here claims
  otherwise.**
- **Data protection:** for Render (the recommended option), the
  documentation states databases are encrypted at rest with AES-256
  — including backups — and external connections are always
  TLS-encrypted. Database access controls (IP allow lists) are
  configured at provisioning. Tenant isolation and
  authorization remain application responsibilities (unchanged).

# 7. Deployment and migration strategy

- Deploy from GitHub `main` on the provider's Git integration; CI
  (GitHub Actions) must be green first — the provider deploy is not a
  substitute for CI.
- Migrations run in the pre-deploy step (`npx prisma migrate deploy`);
  a failing migration fails the deploy and the previous release keeps
  serving (verified behaviour on Render; same on Railway).
- Migration discipline stays expand-and-contract (repo standards):
  a code rollback never requires a database rollback, and destructive
  changes ship in a later release than the code that stops using the
  old shape. The CI `db-upgrade` job rehearses every release's
  migrations against the previous release's seeded schema before they
  can reach a populated database.
- Rollback of a bad release = redeploy the previous release's commit;
  database state is handled by the expand-and-contract rule above or,
  worst case, the §6 restore path.

# 8. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Railway's PITR plan gate is unverifiable from docs (affects only the fallback) | No-spend dashboard check before any Railway commitment; Render is the default and needs no such check |
| Render exceeds the ₹1,000 target (~₹1,264–1,378) | Target is explicitly subordinate to reliability (original §29); the cheaper options sacrifice PITR or certainty |
| No India region on any option → latency from Singapore (~tens of ms) and a residency preference unmet | Accept for the pilot (workload is latency-tolerant); revisit if a provider launches India or residency becomes a customer requirement |
| Single-instance availability (no HA at entry tiers on all three) | Accepted for a pilot; uptime ping + provider status; revisit if the §5 scale assumptions are exceeded or availability requirements grow |
| PITR window is only 3 days on the Hobby workspace — a problem discovered later may be unrecoverable | On-demand logical exports can supplement the window only when actually created (retained 7 days after creation; not scheduled); drill discipline; move the workspace to Pro (7-day window) when real payment volume justifies ~₹2,375/mo more |
| Student-credit dependence (Heroku path only) | Not on the recommended path; if ever used, the architecture must remain viable after expiry (original §5) |
| Metered-cost surprise (Railway path only) | Not on the recommended path; Render is flat |

# 9. Open questions requiring owner approval

1. **Budget:** approve ~₹1,264–1,378/month for the recommended Render
   shape, above the ₹0–1,000 target — or direct a cheaper option with
   its trade-off accepted explicitly?
2. **Region/residency:** is Singapore acceptable for the pilot, given
   no evaluated provider offers India on these tiers?
3. **Recovery expectations:** is a 3-day PITR window, on-demand
   logical exports, and a pre-launch restore drill sufficient for pilot
   payment records, or is the Pro workspace's 7-day window required
   from day one?
4. **Usage/growth:** are the §5 assumptions right (one pilot gym,
   ≤ 5 GB data, low egress, no workers) for the first months?
5. **Platform preference:** managed platform (recommended) vs cloud
   infrastructure (e.g. Azure with student credit, original §6) — the
   latter was not costed here because it raises operational complexity
   against the original text's own simplicity rule; approve excluding it,
   or request a costed comparison?
6. **Railway check:** run the no-spend dashboard check (does Hobby
   allow PITR + Singapore?) before final sign-off, or proceed on
   Render without it?
7. **Timing:** when is Stage 0 provisioning authorized (it incurs the
   §5 spend), and is a custom domain purchased for the pilot or
   deferred (original §18)?

# 10. Official sources and research date

Researched 2026-10-18 (first verification pass 2026-10-14/15;
differences found on re-verification are noted). Official vendor
sources only:

- Render pricing & cost article — https://render.com/articles/how-much-does-cloud-application-hosting-cost-for-small-businesses (Starter-class web + Basic-256mb PG ≈ $13/mo combined; workspace Hobby $0 / Pro $25; free-tier limits). The individual $7/$6 split was verified 2026-10-14 from render.com/pricing; the pricing page's tables are client-rendered and the split could not be re-extracted on 2026-10-18, but Render's own article confirms the combined figure for exactly this pairing.
- Render Postgres backups/PITR — https://render.com/docs/postgresql-backups (PITR on all paid plans; 3-day window Hobby workspace, 7-day Pro+; logical exports 7 days).
- Render Postgres connections/billing — https://render.com/docs/postgresql-creating-connecting (100 connections < 8 GB RAM; storage $0.30/GB/mo on flexible plans).
- Render regions — https://render.com/docs/regions (Singapore available; no India region).
- Render deploys (pre-deploy command) — https://render.com/docs/deploys.md ; custom domains/TLS — https://render.com/docs/custom-domains .
- Railway pricing — https://docs.railway.com/pricing and https://docs.railway.com/pricing/plans (Hobby $5, Pro $20, subscription counts toward usage; RAM $10/GB/mo, CPU $20/vCPU/mo, volume $0.15/GB/mo, egress $0.05/GB).
- Railway PITR — https://docs.railway.com/volumes/point-in-time-recovery (pgBackRest WAL archiving, ~4-week window, restore to a new service, no separate fee; **no plan gate stated** — the Pro-requirement reports are third-party and unverified).
- Railway regions — https://docs.railway.com/deployments/regions (Singapore `asia-southeast1-eqsg3a`; no India region).
- Railway pre-deploy command — https://docs.railway.com/deployments/pre-deploy-command (verified 2026-10-18; previously unverified).
- Heroku pricing — https://www.salesforce.com/heroku/pricing/ (Basic dyno $7/mo).
- Heroku Postgres plans — https://devcenter.heroku.com/articles/heroku-postgres-plans (Essential-0/1/2: $5/$9/$20; 20/20/40 connections).
- Heroku data safety — https://devcenter.heroku.com/articles/heroku-postgres-data-safety-and-continuous-protection (no rollbacks/PITR on Essential; Standard+ only).
- Heroku PGBackups — https://devcenter.heroku.com/articles/heroku-postgres-backups (Essential: daily backups retained 7 days + 1 weekly; manual cap 5 — updated 2026-10-08; this corrects the 1–2-day retention recorded in the October comparison).
- Heroku regions — https://devcenter.heroku.com/articles/regions (Common Runtime: US/EU only).
- Heroku for GitHub Students — https://help.heroku.com/FFN35ZM2 ($13/mo × 24 months, no rollover).
- USD/INR 95.01 — Finnhub USD/INR quote (95.0137), retrieved 2026-10-18.

Estimates vs facts: plan prices, PITR terms, regions, and connection
limits above are verified facts from the sources listed. Railway's
monthly total is an estimate from metered rates; all INR figures are
conversions at the stated rate, not vendor INR billing.
