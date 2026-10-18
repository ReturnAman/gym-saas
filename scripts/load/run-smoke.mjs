#!/usr/bin/env node
/**
 * Guarded launcher for the local k6 smoke test
 * (scripts/load/run-smoke.mjs).
 *
 * This wrapper exists so the smoke test can never be pointed at the
 * wrong target by accident. Before k6 is even invoked it verifies:
 *
 *   1. DATABASE_URL passes the disposable-database guard
 *      (scripts/load/guard.mjs): gymsaas_load* naming, loopback host,
 *      no target-overriding query parameters, and
 *      LOAD_TEST_CONFIRM_DATABASE exactly matching the database name.
 *   2. BASE_URL (default http://localhost:3000) is an http URL on a
 *      loopback host — this slice is local-only; the load generator
 *      never targets a deployed environment.
 *   3. The actors file exists and was generated against the SAME
 *      database the guard just confirmed (its recorded databaseName
 *      must match).
 *   4. The application answers GET /api/health, AND — the binding
 *      check — it accepts a seeded actor session: GET
 *      /member/payments with the first actor's cookie must return
 *      the payments page itself, not a redirect to the sign-in
 *      landing. The wrapper cannot read the app's DATABASE_URL, so
 *      this probe is how it positively establishes that the running
 *      app is connected to the confirmed database: the seeded
 *      session token exists only there. If the app were started
 *      against any other database, the probe fails and k6 is never
 *      invoked. (The app must already be running; see
 *      scripts/load/README.md — this script never starts it.)
 *
 * Only then does it spawn `k6 run scripts/load/k6/smoke.js`. If the
 * k6 binary is missing, it prints installation guidance and exits
 * non-zero; it never installs anything and never falls back to another
 * load tool.
 *
 * Usage:
 *   DATABASE_URL=postgres://…@localhost:5432/gymsaas_load_local \
 *   LOAD_TEST_CONFIRM_DATABASE=gymsaas_load_local \
 *   [BASE_URL=http://localhost:3000] \
 *     node scripts/load/run-smoke.mjs [--print-config]
 *
 * --print-config validates everything above and prints the resolved
 * configuration, without probing health or invoking k6.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertLoadTestDatabase, LOOPBACK_HOSTS } from "./guard.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ACTORS_FILE = path.join(SCRIPT_DIR, "actors.local.json");
const SMOKE_SCRIPT = path.join(SCRIPT_DIR, "k6", "smoke.js");

function fail(message) {
  console.error(`run-smoke: ${message}`);
  process.exit(1);
}

async function main() {
  const printConfig = process.argv.includes("--print-config");

  let databaseName;
  try {
    ({ databaseName } = assertLoadTestDatabase());
  } catch (error) {
    fail(error.message);
  }

  const baseUrlRaw = process.env.BASE_URL ?? "http://localhost:3000";
  let baseUrl;
  try {
    baseUrl = new URL(baseUrlRaw);
  } catch {
    fail(`BASE_URL "${baseUrlRaw}" is not a valid URL — refusing to run.`);
  }
  if (baseUrl.protocol !== "http:") {
    fail(
      `BASE_URL protocol "${baseUrl.protocol}" is not http: — the local app ` +
        "serves plain http on loopback; refusing to run.",
    );
  }
  const baseHost = baseUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!LOOPBACK_HOSTS.includes(baseHost)) {
    fail(
      `BASE_URL host "${baseUrl.hostname}" is not loopback — this tooling is ` +
        "local-only and never sends load to a deployed environment.",
    );
  }
  const baseUrlString = baseUrl.toString().replace(/\/$/, "");

  if (!existsSync(ACTORS_FILE)) {
    fail(
      `actors file not found at ${ACTORS_FILE} — run the seed first:\n` +
        "  node scripts/load/seed-load-test.mjs",
    );
  }
  let actorsDoc;
  try {
    actorsDoc = JSON.parse(readFileSync(ACTORS_FILE, "utf8"));
  } catch {
    fail(`actors file at ${ACTORS_FILE} is not valid JSON — re-run the seed.`);
  }
  if (actorsDoc.databaseName !== databaseName) {
    fail(
      `actors file was generated for database "${actorsDoc.databaseName}" but the ` +
        `guard confirmed "${databaseName}" — re-run the seed against this database ` +
        "so sessions and data belong to the same dataset.",
    );
  }
  const actorCount = Array.isArray(actorsDoc.actors) ? actorsDoc.actors.length : 0;
  if (actorCount === 0) {
    fail("actors file contains no actors — re-run the seed with LOAD_ACTORS_PER_GYM >= 1.");
  }

  console.log(
    `run-smoke: target app ${baseUrlString}, database "${databaseName}" ` +
      `(confirmed disposable), ${actorCount} seeded actor(s).`,
  );
  if (printConfig) {
    console.log("run-smoke: --print-config — configuration valid; k6 was not invoked.");
    return;
  }

  // The application must already be running against the seeded DB.
  // Both probes are time-bounded so a hung app fails instead of
  // hanging the wrapper.
  let health;
  try {
    health = await fetch(`${baseUrlString}/api/health`, {
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    fail(
      `the application is not reachable at ${baseUrlString} — start it against the ` +
        "seeded database first (see scripts/load/README.md), then re-run.",
    );
  }
  if (!health.ok) {
    fail(`GET /api/health returned ${health.status} — refusing to run against an unhealthy app.`);
  }

  // Binding probe: the first actor's seeded session must resolve in
  // the running app. Member pages redirect to /member when the
  // session does not resolve, so landing anywhere other than the
  // payments page itself means the app is NOT connected to the
  // confirmed database (or the dataset was reseeded since).
  const probeActor = actorsDoc.actors[0];
  if (!probeActor?.token || !probeActor?.gymId) {
    fail("actors file is malformed (first actor lacks a token) — re-run the seed.");
  }
  let probe;
  try {
    probe = await fetch(`${baseUrlString}/member/payments`, {
      headers: { Cookie: `gym_member_session=${probeActor.token}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    fail("the session probe request failed — refusing to run.");
  }
  const probePath = new URL(probe.url).pathname;
  if (!probe.ok || probePath !== "/member/payments") {
    fail(
      `the running app did not accept a seeded session (probe landed on ${probePath}) — ` +
        `it is probably not connected to database "${databaseName}". Start the app ` +
        "against the confirmed database and re-run; k6 was not invoked.",
    );
  }
  console.log(
    `run-smoke: app confirmed against database "${databaseName}" via seeded-session probe.`,
  );

  const child = spawn("k6", ["run", SMOKE_SCRIPT], {
    stdio: "inherit",
    env: { ...process.env, BASE_URL: baseUrlString, ACTORS_FILE },
  });
  child.on("error", (error) => {
    if (error.code === "ENOENT") {
      fail(
        "the `k6` binary was not found on PATH. Install k6 from " +
          "https://k6.io/docs/get-started/installation/ and re-run. " +
          "This script never installs tooling itself.",
      );
    }
    fail(`failed to launch k6: ${error.message}`);
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      console.error(`run-smoke: k6 exited via signal ${signal}.`);
      process.exit(1);
    }
    process.exit(code ?? 1);
  });
}

main().catch((error) => {
  fail(error.message ?? String(error));
});
