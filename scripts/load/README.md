# Local load-test tooling

Synthetic-data seeding and guarded k6 load tests for the Gym SaaS
app, **local use only**. Four scenarios exercise member-session
surfaces at increasing load: smoke (5 virtual users), baseline
(50), peak (150 plus a check-in burst), and spike/soak (300).
Smoke, baseline, and peak each run ONLY through a guarded wrapper
(`run-smoke.mjs`, `run-baseline.mjs`, `run-peak.mjs`) that
verifies the safety chain in the next section before k6 is
invoked; spike/soak has no wrapper yet and has never run. Results
so far are local-hardware evidence about member paths only —
nothing here establishes that the app supports the 14-gym /
1,700-member target on any real hosting (see Known limitations
for the executed history).

## Safety model (read this first)

Every script in this directory refuses to run unless the target is
provably a disposable local database:

- `DATABASE_URL` must name a database matching `gymsaas_load` plus
  optional lowercase alphanumeric underscore segments
  (`gymsaas_load_local`, `gymsaas_load_full`, …). A name merely
  containing "load" is not sufficient.
- Names containing a production-like segment (`prod`, `production`,
  `live`, `pilot`, `staging`, `customer`, `real`) are refused even
  when the rest of the name conforms.
- The host must be loopback (`localhost`, `127.0.0.1`, `::1`). This
  tooling never targets a remote or deployed database, ever.
- Query parameters that could override the connection target
  (`host`, `hostaddr`, `database`, `dbname`) are refused — the `pg`
  driver honours a `host` parameter over the URL's own host.
- `LOAD_TEST_CONFIRM_DATABASE` must be set and exactly equal the
  database name in `DATABASE_URL`. A name alone is never proof of
  disposability; the operator confirms the exact database.

All checks are pure string validation performed **before** any
connection (see `guard.mjs`, which mirrors the upgrade-test guard in
`scripts/run-upgrade-test.mjs`). On top of that, the seed refuses to
run in a database containing non-load-test organizations, and refuses
to re-seed over an existing load-test dataset (use `--cleanup`).

The load runner adds its own checks: the app URL must be `http` on
loopback, the actors file must have been generated against the same
confirmed database, and — the binding check — the running app must
accept a seeded actor session (`GET /member/payments` with an actor
cookie must return the page, not a redirect to the sign-in landing).
The wrapper cannot read the app's `DATABASE_URL`; since a seeded
session token exists only in the confirmed database, the probe is
what positively ties the running app to that database. If it fails,
k6 is never invoked.

## Test-session strategy

- **Member sessions are seeded directly.** The seed inserts
  `member_sessions` rows exactly as the member linking flow creates
  them: it generates a raw token per actor, stores only its SHA-256
  hash in the database, and writes the raw tokens to
  `actors.local.json` (gitignored). k6 presents the token as the
  `gym_member_session` cookie. Resolution, expiry, and tenant binding
  are the application's real code paths — a seeded session for Gym A
  cannot check in to Gym B (the route rejects it with `GYM_MISMATCH`),
  and an unknown token is treated as signed out.
- **No Clerk, no OTP, no APITxT.** Staff/Clerk sessions cannot be
  seeded and are **not** covered by these scripts; staff surfaces
  remain covered by the Playwright E2E suites. No OTP is ever
  requested, so the SMS provider sees zero load-test traffic.
- Actor tokens are credentials for synthetic accounts in a local
  database. Treat `actors.local.json` accordingly: never commit it
  (it is gitignored), never reuse it anywhere else, and regenerate it
  by re-seeding.

## Setup

Prerequisites: Node 20, a local PostgreSQL 16, and the k6 binary
(https://k6.io/docs/get-started/installation/) for the run step only.

```bash
# 1. Create the disposable database (name must match the convention)
createdb gymsaas_load_local        # or your provider's equivalent

# 2. Apply the application schema
DATABASE_URL=postgres://YOUR_DB_USER@localhost:5432/gymsaas_load_local \
  npx prisma migrate deploy

# 3. Seed synthetic data (defaults: 14 gyms, ~1,700 members)
DATABASE_URL=postgres://YOUR_DB_USER@localhost:5432/gymsaas_load_local \
LOAD_TEST_CONFIRM_DATABASE=gymsaas_load_local \
  node scripts/load/seed-load-test.mjs

# 4. Start the app against the SAME database (dummy Clerk keys are
#    enough: member paths never call Clerk, and the CI build does the
#    same; leave APITXT_API_KEY and MEMBER_OTP_HMAC_SECRET unset)
DATABASE_URL=postgres://YOUR_DB_USER@localhost:5432/gymsaas_load_local \
APP_URL=http://localhost:3000 \
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_ZHVtbXkubG9jYWwk \
CLERK_SECRET_KEY=sk_test_dummy \
  npm run build && npm run start
```

Seed scale knobs: `LOAD_GYMS` (default 14), `LOAD_MEMBERS_PER_GYM`
(default: varied 118–127 per gym), `LOAD_ACTORS_PER_GYM` (default 2),
`LOAD_ATTENDANCE_DAYS` (default 90). Seeding is deterministic in shape
(fixed RNG seed) except for IDs and session tokens, runs in one
transaction (any failure rolls everything back), and ends with
consistency assertions: no payment references a member of another
gym, confirmed claims equal claim-linked payments, and no attendance
session is left open. The seeded dataset contains no audit-log rows —
audit history is written by the application at runtime and no
load-relevant read path uses it.

## Running the smoke test

```bash
DATABASE_URL=postgres://YOUR_DB_USER@localhost:5432/gymsaas_load_local \
LOAD_TEST_CONFIRM_DATABASE=gymsaas_load_local \
  node scripts/load/run-smoke.mjs
```

Add `--print-config` to validate the configuration without probing
or invoking k6. The smoke run itself: 5 VUs for 5 minutes, each VU
acting as one seeded member — `GET /api/health`, `GET /member`,
`GET /member/payments`, `GET /member/attendance`, and
`POST /api/member-attendance/check-in` for the actor's own gym.
First-pass check-ins return `checked_in`, repeats return
`already_checked_in`; both are passes (together they exercise the
one-open-session rule). Thresholds in `k6/smoke.js` are smoke gates
(the run is healthy), **not** the audit's capacity targets.

Note: re-running the smoke against the same dataset leaves the actor
members checked in (their repeat check-ins return
`already_checked_in`, still a pass). Re-seed (cleanup + seed) for a
pristine first-pass run.

## Scenarios

| Script | Shape | Status |
| --- | --- | --- |
| `k6/smoke.js` | 5 VU, 5 min | Implemented; executed 2026-10-19 (recorded as passed); run via `run-smoke.mjs` |
| `k6/baseline.js` | 50 VU, 15 min | Executed 2026-10-19 — **passed** its configured thresholds; wrapper-only via `run-baseline.mjs` |
| `k6/peak.js` | 150 VU, 15 min + 30/min check-in burst for 5 min | Executed 2026-10-19 — **failed** the read-latency thresholds, passed correctness and reconciliation; wrapper-only via `run-peak.mjs` |
| `k6/spike-soak.js` | ramp to 300 VU, 5-min spike, 150 VU for 30-min soak | **Prepared — not yet run; no guarded wrapper exists yet** |

All scenarios share `k6/lib.js` (actor loading, the loopback target
check, the standard member iteration) and cover **member-session
surfaces only**. The audit's full mix also includes staff surfaces
(member list/detail, staff-recorded payments); those are absent
until the staff-auth strategy for load testing is decided, so
results from these scripts are member-path evidence, not
whole-system evidence. The prepared scenarios carry the audit's
targets as their thresholds (reads p95 < 500 ms, writes p95 <
800 ms, errors < 0.5% at baseline/peak, < 2% at spike).

Baseline and peak are **wrapper-only**: never invoke their k6
scripts directly. Each wrapper applies the full safety chain from
the Safety model section (disposable-database guard plus explicit
confirmation, loopback app URL, actors/database match, health and
seeded-session binding probes) before k6 starts, writes a JSON
export to `results/` by default, forwards termination signals to
k6, and propagates its exit code. Run them in stage order, each
only after the preceding stage has passed:

```bash
# Baseline (after smoke has passed)
DATABASE_URL=postgres://YOUR_DB_USER@localhost:5432/gymsaas_load_local \
LOAD_TEST_CONFIRM_DATABASE=gymsaas_load_local \
  node scripts/load/run-baseline.mjs

# Peak (after baseline has passed)
DATABASE_URL=postgres://YOUR_DB_USER@localhost:5432/gymsaas_load_local \
LOAD_TEST_CONFIRM_DATABASE=gymsaas_load_local \
  node scripts/load/run-peak.mjs
```

Both wrappers accept `--print-config` (validate the guard,
BASE_URL, and actors checks and print the resolved configuration,
without probing or invoking k6), `--out <path>` (override the
export path — contained to `results/` and symlink-checked), and
`--no-out`. Spike/soak has no guarded wrapper yet: do not run it
until one exists or a run is separately approved.

## Instrumentation

Collect evidence while a scenario runs, not just the k6 summary:

- **k6** prints per-surface latency (requests carry `name` tags, and
  thresholds are set per surface) and the HTTP failure rate. The
  guarded wrappers write a durable JSON export to
  `scripts/load/results/k6-<scenario>.json` by default (the
  `results/` directory is gitignored).
- **Database snapshots** — `collect-stats.mjs` is guarded by the
  same disposable-database rules and is read-only. Take one snapshot
  before, during (every few minutes on long stages), and after:
  ```bash
  DATABASE_URL=… LOAD_TEST_CONFIRM_DATABASE=gymsaas_load_local \
    node scripts/load/collect-stats.mjs --label before
  ```
  Snapshots append to `scripts/load/results/stats.jsonl`: connection
  counts (total / active / idle-in-transaction / lock-waiting),
  commit/rollback/deadlock counters, cache-hit ratio, hot-table
  sizes, and — when enabled — the top queries by total time.
- **Pool saturation** has a specific signature: the app pool is
  capped (default `max: 8` per instance), so saturation shows as
  `active` connections in the snapshots plateauing at the pool size
  **while** the app's stdout accumulates `database_unavailable` log
  events and clients see 503s. Count them after a run:
  `grep -c database_unavailable <app-log>`. Statement timeouts (15 s
  default) surface as `unexpected_error`/timeout events in the same
  log — any occurrence at or below the peak stage is a finding.
- **Query performance**: enable `pg_stat_statements` on the LOCAL
  cluster only, for per-query timings in the snapshots:
  ```sql
  ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';
  -- restart PostgreSQL, then:
  CREATE EXTENSION pg_stat_statements;
  ```
  Without it, snapshots simply omit the top-query section and say so.

## Cleanup

```bash
# Remove the seeded dataset (keeps the migrated schema). Cleanup
# applies the same exclusivity rule as seeding — it refuses if the
# database holds non-load-test organizations — and removes the
# actors file only when it belongs to this database.
DATABASE_URL=… LOAD_TEST_CONFIRM_DATABASE=gymsaas_load_local \
  node scripts/load/seed-load-test.mjs --cleanup

# Or drop the disposable database entirely
dropdb gymsaas_load_local
```

## Verifying tenant isolation and consistency after a run

Run these against the load database and confirm the expected values:

```sql
-- Cross-tenant integrity: every count must be 0. (Composite foreign
-- keys make these impossible; the queries prove the run changed
-- nothing structural.)
SELECT count(*) FROM payments p JOIN members m ON m.id = p.member_id
 WHERE m.organization_id <> p.organization_id;
SELECT count(*) FROM attendance_sessions a JOIN members m ON m.id = a.member_id
 WHERE m.organization_id <> a.organization_id;

-- Payment consistency: derived paid per membership never exceeds the
-- fee by more than a deliberate overpayment (the seed creates none,
-- so paid > fee must be 0 rows here), and every CONFIRMED claim has
-- exactly one linked payment.
SELECT count(*) FROM (
  SELECT ms.id FROM memberships ms JOIN payments p ON p.membership_id = ms.id
   GROUP BY ms.id, ms.fee HAVING sum(p.amount) > ms.fee
) overpaid;
SELECT
  (SELECT count(*) FROM payment_claims WHERE status = 'CONFIRMED') AS confirmed_claims,
  (SELECT count(*) FROM payments WHERE payment_claim_id IS NOT NULL) AS linked_payments;
-- The two counts above must be equal.

-- Attendance consistency: at most one OPEN session per member,
-- and open sessions exist only for members a run actually checked in.
SELECT member_id, count(*) FROM attendance_sessions
 WHERE check_out_at IS NULL GROUP BY member_id HAVING count(*) > 1;
-- Must return 0 rows.

-- Per-gym footprint after a run:
SELECT o.name, count(DISTINCT m.id) AS members, count(a.id) AS attendance_rows
  FROM organizations o
  LEFT JOIN members m ON m.organization_id = o.id
  LEFT JOIN attendance_sessions a ON a.organization_id = o.id
 GROUP BY o.name ORDER BY o.name;
```

## Known limitations of this slice

- Executed history (2026-10-19, local hardware): smoke recorded
  as passed;
  the baseline (50 VU, 15 min) executed through its guarded
  wrapper and **passed** its configured thresholds (0.00% HTTP
  failures, every per-surface p95 target met, correctness
  reconciliation exact); the peak (150 VU, 15 min + check-in
  burst) executed through its guarded wrapper and **failed** its
  read-latency thresholds (member-page p95 ≈ 2.9 s against a
  500 ms target) while passing every error, correctness, and
  data-reconciliation check (0.00% failures, exactly +28
  attendance rows, all other totals unchanged). Spike/soak is
  prepared but has never run and has no guarded wrapper. All
  scenarios cover member paths only (no staff surfaces — see
  Scenarios). No stage result is evidence the app supports the
  14-gym / 1,700-member target.
- Local results do not transfer to Railway (different CPU, memory,
  network, and database plan); a deployed Stage 0 run is a separate,
  separately authorized step.
- Membership renewal does not exist in the application yet, so no
  renewal path is exercised.
