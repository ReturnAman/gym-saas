#!/usr/bin/env node
/**
 * Read-only database statistics collector for local load-test runs
 * (scripts/load/collect-stats.mjs).
 *
 * Takes a labelled snapshot of the database health signals that
 * matter while a load scenario runs, and appends it as one JSON line
 * to scripts/load/results/stats.jsonl:
 *
 *   - connections: total / active / idle-in-transaction / lock-waiting
 *     sessions on THIS database. The application pool is capped
 *     (default max 8 per instance), so "active" plateauing at the
 *     pool size while the app logs DATABASE_UNAVAILABLE is the
 *     pool-saturation signature.
 *   - pg_stat_database counters: commits, rollbacks, cache-hit ratio,
 *     deadlocks, temp bytes — cumulative since stats reset; compare
 *     before/after snapshots, not absolutes.
 *   - top queries by total execution time from pg_stat_statements,
 *     when the extension is enabled (it is optional; see below).
 *   - row counts and total sizes for the hot tables.
 *
 * The collector is strictly read-only and passes the same
 * disposable-database guard as the seed (scripts/load/guard.mjs):
 * gymsaas_load* naming, loopback only, explicit confirmation.
 *
 * pg_stat_statements (optional): if the extension is absent, the
 * snapshot is still written and the console explains how to enable it
 * on a LOCAL PostgreSQL:
 *     ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';
 *     -- restart PostgreSQL, then:
 *     CREATE EXTENSION pg_stat_statements;
 * Never enable it anywhere but the local test database cluster.
 *
 * Usage:
 *   DATABASE_URL=postgres://…@localhost:5432/gymsaas_load_local \
 *   LOAD_TEST_CONFIRM_DATABASE=gymsaas_load_local \
 *     node scripts/load/collect-stats.mjs --label before|during|after
 */

import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { assertLoadTestDatabase } from "./guard.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = path.join(SCRIPT_DIR, "results", "stats.jsonl");
const HOT_TABLES = [
  "organizations", "members", "memberships", "payments",
  "payment_claims", "attendance_sessions", "member_sessions",
  "member_otp_challenges", "audit_logs",
];

function fail(message) {
  console.error(`collect-stats: ${message}`);
  process.exit(1);
}

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  let database;
  try {
    database = assertLoadTestDatabase();
  } catch (error) {
    fail(error.message);
  }
  const { databaseUrl, databaseName } = database;
  const label = argValue("--label") ?? "snapshot";
  const outFile = argValue("--out") ?? DEFAULT_OUT;

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const snapshot = { ts: new Date().toISOString(), label, database: databaseName };

    const { rows: activity } = await client.query(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE state = 'active')::int AS active,
         count(*) FILTER (WHERE state = 'idle in transaction')::int AS idle_in_transaction,
         count(*) FILTER (WHERE wait_event_type = 'Lock')::int AS waiting_on_lock
       FROM pg_stat_activity WHERE datname = current_database()`,
    );
    snapshot.connections = activity[0];

    const { rows: dbStats } = await client.query(
      `SELECT xact_commit, xact_rollback, deadlocks, temp_bytes,
              CASE WHEN blks_hit + blks_read > 0
                   THEN round(100.0 * blks_hit / (blks_hit + blks_read), 2)
                   ELSE NULL END AS cache_hit_pct
         FROM pg_stat_database WHERE datname = current_database()`,
    );
    snapshot.database = dbStats[0] ?? null;

    const { rows: ext } = await client.query(
      `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') AS enabled`,
    );
    if (ext[0].enabled) {
      const { rows: top } = await client.query(
        `SELECT calls, round(total_exec_time::numeric, 1) AS total_ms,
                round(mean_exec_time::numeric, 2) AS mean_ms, rows,
                left(query, 200) AS query
           FROM pg_stat_statements
          WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
          ORDER BY total_exec_time DESC LIMIT 10`,
      );
      snapshot.topQueries = top;
    } else {
      snapshot.topQueries = null;
      console.log(
        "collect-stats: pg_stat_statements is not enabled — top-query section skipped.\n" +
          "  To enable on this LOCAL cluster:\n" +
          "    ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';\n" +
          "    -- restart PostgreSQL, then: CREATE EXTENSION pg_stat_statements;",
      );
    }

    const { rows: tables } = await client.query(
      `SELECT relname AS table, n_live_tup::bigint AS approx_rows,
              pg_total_relation_size(relid) AS total_bytes
         FROM pg_stat_user_tables WHERE relname = ANY($1) ORDER BY relname`,
      [HOT_TABLES],
    );
    snapshot.tables = tables;

    mkdirSync(path.dirname(outFile), { recursive: true });
    appendFileSync(outFile, JSON.stringify(snapshot) + "\n");

    console.log(
      `collect-stats [${label}] ${databaseName}: connections ` +
        `total=${snapshot.connections.total} active=${snapshot.connections.active} ` +
        `idle-in-tx=${snapshot.connections.idle_in_transaction} lock-wait=${snapshot.connections.waiting_on_lock}; ` +
        `cache-hit=${snapshot.database?.cache_hit_pct ?? "n/a"}%; ` +
        `deadlocks=${snapshot.database?.deadlocks ?? "n/a"}; ` +
        `top-queries=${snapshot.topQueries ? snapshot.topQueries.length : "unavailable"}.`,
    );
    console.log(`collect-stats: appended to ${outFile}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  fail(error.message ?? String(error));
});
