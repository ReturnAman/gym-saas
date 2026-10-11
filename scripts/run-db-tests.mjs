#!/usr/bin/env node
/**
 * Runner for the opt-in PostgreSQL integration suites (`npm run test:db`).
 *
 * Why this exists: the tenant-integrity suites skip themselves unless
 * RUN_DB_TESTS=true, and Vitest exits 0 when tests are skipped — so a
 * CI job could go green while the database suites never executed. This
 * runner pins RUN_DB_TESTS=true (as the previous inline script did) and
 * then reads Vitest's JSON summary: the run FAILS unless every test in
 * the four suites actually executed and passed (zero failed, zero
 * pending/skipped, zero todo, at least one test). A failed database
 * connection still fails through Vitest's own exit code and file-level
 * failures — it is never mistaken for a healthy run with skips, and a
 * healthy-looking exit with skips is never mistaken for success.
 *
 * Extra suite paths may be appended as CLI arguments (used to probe
 * the skip guard in verification); the four suites below always run.
 *
 * Failures are reported by throwing: the top-level handler records the
 * message and sets a nonzero exit code, so the `finally` block always
 * removes the temporary results directory. (Calling process.exit()
 * directly would bypass the finally cleanup.)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SUITES = [
  "src/lib/server/__tests__/membership-tenant-integrity.test.ts",
  "src/lib/server/__tests__/payment-tenant-integrity.test.ts",
  "src/lib/server/__tests__/attendance-tenant-integrity.test.ts",
  "src/lib/server/__tests__/staff-tenant-integrity.test.ts",
  ...process.argv.slice(2),
];

const resultsDir = mkdtempSync(path.join(tmpdir(), "gymsaas-db-tests-"));
const resultsFile = path.join(resultsDir, "results.json");

function fail(message) {
  throw new Error(message);
}

try {
  const vitestCli = path.join(repoRoot, "node_modules", "vitest", "vitest.mjs");
  const child = spawnSync(
    process.execPath,
    [
      vitestCli,
      "run",
      ...SUITES,
      "--reporter=default",
      "--reporter=json",
      `--outputFile=${resultsFile}`,
    ],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: { ...process.env, RUN_DB_TESTS: "true" },
    },
  );

  let summary;
  try {
    summary = JSON.parse(readFileSync(resultsFile, "utf8"));
  } catch {
    fail(
      `Vitest did not produce a JSON summary (child exit status ${child.status}). ` +
        "Treating the run as failed — the database suites did not verifiably execute.",
    );
  }

  const {
    numTotalTests = 0,
    numPassedTests = 0,
    numFailedTests = 0,
    numPendingTests = 0,
    numTodoTests = 0,
  } = summary;

  console.log(
    `test:db summary: ${numPassedTests} passed, ${numFailedTests} failed, ` +
      `${numPendingTests} skipped/pending, ${numTodoTests} todo (${numTotalTests} total)`,
  );

  if (child.status !== 0) {
    fail(`Vitest exited with status ${child.status}.`);
  }
  if (numTotalTests === 0) {
    fail("no tests were collected — the database suites did not execute.");
  }
  if (numFailedTests > 0) {
    fail(`${numFailedTests} test(s) failed.`);
  }
  if (numPendingTests > 0 || numTodoTests > 0) {
    fail(
      `${numPendingTests + numTodoTests} test(s) did not execute (skipped/pending/todo). ` +
        "The database suites must run in full; a run with skips is a failed run.",
    );
  }
  console.log("test:db: all PostgreSQL integration tests executed and passed.");
} catch (error) {
  console.error(`test:db: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  rmSync(resultsDir, { recursive: true, force: true });
}
