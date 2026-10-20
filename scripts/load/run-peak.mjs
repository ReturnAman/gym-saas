#!/usr/bin/env node
/**
 * Guarded launcher for the local k6 peak test
 * (scripts/load/run-peak.mjs).
 *
 * This wrapper applies the baseline wrapper's safety model
 * (scripts/load/run-baseline.mjs) to the 150-VU peak scenario, so
 * the peak can never be pointed at the wrong target by accident.
 * Before k6 is even invoked it verifies:
 *
 *   1. DATABASE_URL passes the disposable-database guard
 *      (scripts/load/guard.mjs): gymsaas_load* naming, loopback host,
 *      no target-overriding query parameters, and
 *      LOAD_TEST_CONFIRM_DATABASE exactly matching the database name.
 *   2. BASE_URL (default http://localhost:3000) is an http URL on a
 *      loopback host — this tooling is local-only; the load
 *      generator never targets a deployed environment.
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
 * Only then does it spawn `k6 run scripts/load/k6/peak.js`,
 * with a JSON results export to scripts/load/results/ (override
 * with --out <path>, disable with --no-out). If the k6 binary is
 * missing, it prints installation guidance and exits non-zero; it
 * never installs anything and never falls back to another load
 * tool.
 *
 * Stage discipline: the peak runs against the application's
 * DEFAULT pool configuration (max 8 connections) — the same
 * discipline as the baseline, so the two stages stay comparable.
 * This wrapper sets no pool variables; any DB_POOL_MAX variation
 * is a separate, explicitly agreed experiment, not part of this
 * stage. Entry condition: the baseline stage has passed (it did,
 * 2026-10-19: 50 VUs, 0.00% failures, all thresholds green,
 * correctness exact). Expected post-run state mirrors the
 * baseline's invariant: exactly 28 new attendance rows and one
 * open session per actor member — the burst scenario only adds
 * duplicate attempts against actors who are already checked in.
 *
 * Usage:
 *   DATABASE_URL=postgres://…@localhost:5432/gymsaas_load_local \
 *   LOAD_TEST_CONFIRM_DATABASE=gymsaas_load_local \
 *   [BASE_URL=http://localhost:3000] \
 *     node scripts/load/run-peak.mjs [--print-config] \
 *       [--out <path> | --no-out]
 *
 * --print-config validates the guard, BASE_URL, and actors checks
 * and prints the resolved configuration, without probing health or
 * invoking k6.
 *
 * Termination signals (SIGINT/SIGTERM) received by the wrapper are
 * forwarded to the spawned k6 child, so interrupting the wrapper
 * never orphans a running load test. --out paths are contained to
 * scripts/load/results/ — lexically AND physically: symbolic links
 * at the target, inside the results tree, or in place of the
 * results directory itself are rejected rather than followed, so
 * an export can never land outside the results directory.
 */

import { spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertLoadTestDatabase, LOOPBACK_HOSTS } from "./guard.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ACTORS_FILE = path.join(SCRIPT_DIR, "actors.local.json");
const PEAK_SCRIPT = path.join(SCRIPT_DIR, "k6", "peak.js");
const RESULTS_DIR = path.join(SCRIPT_DIR, "results");
const DEFAULT_OUT_FILE = path.join(RESULTS_DIR, "k6-peak.json");

function fail(message) {
  console.error(`run-peak: ${message}`);
  process.exit(1);
}

/**
 * Resolve an export-path candidate and prove it stays inside the
 * results directory PHYSICALLY, not just lexically. The prefix
 * check alone is defeated by symbolic links: a link planted inside
 * results/ would let an export land anywhere on disk, and results/
 * itself could be a link out of the tree. This validator therefore
 * also:
 *   - rejects the target outright if it already exists as a symlink
 *     (k6 would otherwise write through it to its target);
 *   - lstat-inspects EVERY directory component from the results
 *     directory down to the target's parent and rejects any that is
 *     a symbolic link. lstat — not existsSync — is essential here:
 *     existsSync follows links and reports a DANGLING symlink (one
 *     whose target does not exist) as absent, so an existence-based
 *     walk would step over `results/dangle -> /tmp/elsewhere` and
 *     the later mkdir/write would follow the link and land outside;
 *   - realpath-resolves the deepest existing directory component
 *     and requires the real destination directory to remain inside
 *     the REAL results directory — itself anchored at the real
 *     script directory, so a results/ replaced by a symlink is
 *     rejected rather than followed.
 * The not-yet-existing tail below the deepest existing ancestor is
 * created later by mkdirSync as real directories. This is a
 * point-in-time check on a single-operator local machine: it
 * defeats pre-planted links and mistaken paths; it is not a
 * race-proof sandbox against an actor rewriting the tree between
 * the check and k6's write. Violations fail closed; on success the
 * lexically resolved path is returned.
 */
function resolveContainedOutFile(requested) {
  const resolved = path.resolve(requested);
  if (!resolved.startsWith(RESULTS_DIR + path.sep)) {
    fail(
      `--out path "${requested}" resolves outside the load-test results ` +
        `directory (${RESULTS_DIR}) — refusing to run.`,
    );
  }
  try {
    if (lstatSync(resolved).isSymbolicLink()) {
      fail(
        `--out path "${requested}" is a symbolic link — exports must be ` +
          "regular files inside the results directory; refusing to run.",
      );
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const realResultsDir = path.join(realpathSync(SCRIPT_DIR), "results");
  // Directory components from the results directory down to the
  // target's parent, outermost first. Missing components are fine
  // (they are created later as real directories); any EXISTING
  // component that is a symlink or not a directory fails closed.
  const relDir = path.relative(RESULTS_DIR, path.dirname(resolved));
  const dirComponents = [RESULTS_DIR];
  if (relDir) {
    const parts = relDir.split(path.sep);
    for (let i = 0; i < parts.length; i++) {
      dirComponents.push(path.join(RESULTS_DIR, ...parts.slice(0, i + 1)));
    }
  }
  let deepestExisting = null;
  for (const component of dirComponents) {
    let stat;
    try {
      stat = lstatSync(component);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      continue;
    }
    if (stat.isSymbolicLink()) {
      fail(
        `--out path "${requested}" passes through a symbolic link at ` +
          `${component} — exports must stay inside the results directory; ` +
          "refusing to run.",
      );
    }
    if (!stat.isDirectory()) {
      fail(
        `--out path "${requested}" passes through ${component}, which is ` +
          "not a directory — refusing to run.",
      );
    }
    deepestExisting = component;
  }
  const realDir = deepestExisting
    ? path.join(
        realpathSync(deepestExisting),
        path.relative(deepestExisting, path.dirname(resolved)),
      )
    : path.join(realResultsDir, relDir);
  if (realDir !== realResultsDir && !realDir.startsWith(realResultsDir + path.sep)) {
    fail(
      `--out path "${requested}" escapes the results directory through a ` +
        `symbolic link (real directory: ${realDir}) — refusing to run.`,
    );
  }
  return resolved;
}

async function main() {
  const printConfig = process.argv.includes("--print-config");
  const noOut = process.argv.includes("--no-out");
  const outIdx = process.argv.indexOf("--out");
  let outFile;
  if (noOut) {
    outFile = null;
  } else if (outIdx >= 0) {
    const requested = process.argv[outIdx + 1];
    if (!requested) {
      fail("--out requires a file path — refusing to run.");
    }
    // Contained lexically and physically (see resolveContainedOutFile):
    // traversal, absolute paths outside results/, prefix look-alikes
    // such as results-evil/, and symbolic-link escapes are all refused.
    outFile = resolveContainedOutFile(requested);
  } else {
    outFile = DEFAULT_OUT_FILE;
  }

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
    `run-peak: target app ${baseUrlString}, database "${databaseName}" ` +
      `(confirmed disposable), ${actorCount} seeded actor(s); scenario: 150 VUs ` +
      `for 15 minutes plus a check-in burst (30/min for 5 minutes from ` +
      `minute 5), against the application's default pool configuration.` +
      (outFile ? ` Results export: ${outFile}.` : " Results export disabled."),
  );
  if (printConfig) {
    console.log("run-peak: --print-config — configuration valid; k6 was not invoked.");
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
  // session does not resolve, and fetch follows redirects, so
  // landing anywhere other than the payments page itself — in
  // particular a redirect to the sign-in landing — means the app is
  // NOT connected to the confirmed database (or the dataset was
  // reseeded since). A login page can therefore never be mistaken
  // for successful binding. The final URL must also match the
  // configured BASE_URL origin exactly: a redirect to a different
  // origin (for example the same path served by another local app
  // on a different port) is rejected, not accepted as binding.
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
  const probeUrl = new URL(probe.url);
  if (!probe.ok || probeUrl.origin !== baseUrl.origin || probeUrl.pathname !== "/member/payments") {
    fail(
      `the running app did not accept a seeded session (probe landed on ${probeUrl.origin}${probeUrl.pathname}) — ` +
        `it is probably not connected to database "${databaseName}". Start the app ` +
        "against the confirmed database and re-run; k6 was not invoked.",
    );
  }
  console.log(
    `run-peak: app confirmed against database "${databaseName}" via seeded-session probe.`,
  );

  const k6Args = ["run"];
  if (outFile) {
    // Re-validate at the point of use: this also covers the default
    // export path (a pre-planted symlink at results/k6-peak.json
    // must not redirect the write) and any tree changes since the
    // path was first parsed.
    resolveContainedOutFile(outFile);
    mkdirSync(path.dirname(outFile), { recursive: true });
    k6Args.push("--out", `json=${outFile}`);
  }
  k6Args.push(PEAK_SCRIPT);
  const child = spawn("k6", k6Args, {
    stdio: "inherit",
    env: { ...process.env, BASE_URL: baseUrlString, ACTORS_FILE },
  });
  // Forward termination signals to k6 so interrupting the wrapper
  // (Ctrl-C in a terminal signals the whole process group, but a
  // signal addressed to the wrapper alone — e.g. `kill <pid>` —
  // would otherwise leave k6 running orphaned until the scenario
  // ends). Registering a handler replaces Node's default
  // terminate-on-signal for the wrapper: the wrapper now stays
  // alive until the child's exit event below propagates k6's exit
  // code (or its signal death) as before. If the child has already
  // exited there is nothing to forward to.
  const forwardSignal = (signal) => {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill(signal);
      } catch {
        // The child exited between the check and the signal; the
        // exit handler below already owns the outcome.
      }
    }
  };
  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));
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
      console.error(`run-peak: k6 exited via signal ${signal}.`);
      process.exit(1);
    }
    process.exit(code ?? 1);
  });
}

main().catch((error) => {
  fail(error.message ?? String(error));
});
