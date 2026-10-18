/**
 * run-baseline.test.mjs — persistent regression tests for the
 * baseline wrapper's export-path validator (resolveContainedOutFile).
 *
 * Black-box: each test copies the wrapper + guard into a temporary
 * directory (the wrapper anchors every path to its own location,
 * so the copy is fully functional), builds symlink fixtures in the
 * COPY's results/ tree — never in the real one — and spawns the
 * wrapper in --print-config mode with an --out candidate.
 *
 * This can never run a load test, by construction:
 *   - every spawn runs with an environment that contains NO
 *     DATABASE_URL and NO LOAD_TEST_CONFIRM_DATABASE, so the
 *     disposable-database guard refuses before any probe or spawn —
 *     the legitimate-path control case asserts exactly that guard
 *     refusal as its expected outcome;
 *   - --print-config additionally returns before any probe even if
 *     the configuration were valid;
 *   - no database is contacted (the guard is pure string
 *     validation and fires before any connection attempt) and k6
 *     is never invoked.
 *
 * Run with:  node --test scripts/load/run-baseline.test.mjs
 * (Node 20's built-in test runner; no dependencies.)
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const REAL_SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

let tmpRoot;
let wrapperCopy;
let resultsDir;

before(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "run-baseline-test-"));
  mkdirSync(path.join(tmpRoot, "k6"), { recursive: true });
  resultsDir = path.join(tmpRoot, "results");
  mkdirSync(resultsDir, { recursive: true });
  for (const file of ["run-baseline.mjs", "guard.mjs"]) {
    copyFileSync(path.join(REAL_SCRIPT_DIR, file), path.join(tmpRoot, file));
  }
  copyFileSync(
    path.join(REAL_SCRIPT_DIR, "k6", "baseline.js"),
    path.join(tmpRoot, "k6", "baseline.js"),
  );
  wrapperCopy = path.join(tmpRoot, "run-baseline.mjs");
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

/** Spawn the copied wrapper for one --out candidate. Deliberately
 * passes NO database URL or confirmation: the disposable-database
 * guard must be the last line of refusal for any case the path
 * validator accepts, so k6 can never launch from these tests. */
function runWrapper(outPath) {
  return spawnSync(process.execPath, [wrapperCopy, "--print-config", "--out", outPath], {
    cwd: tmpRoot,
    env: { PATH: process.env.PATH },
    encoding: "utf8",
  });
}

test("dangling directory symlink with a nested output path is rejected", () => {
  const outsideTarget = path.join(tmpRoot, "outside-not-created");
  symlinkSync(outsideTarget, path.join(resultsDir, "dangle"));
  const candidate = path.join(resultsDir, "dangle", "evil.json");
  const result = runWrapper(candidate);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /passes through a symbolic link/);
  // The rejection happens before any directory creation: neither the
  // link's outside target nor the export file may appear.
  assert.equal(existsSync(outsideTarget), false);
  assert.equal(existsSync(candidate), false);
});

test("dangling symlink at the output target is rejected", () => {
  const candidate = path.join(resultsDir, "dangling.json");
  symlinkSync(path.join(tmpRoot, "no-such-file"), candidate);
  const result = runWrapper(candidate);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /is a symbolic link/);
});

test("live symlinked subdirectory is rejected", () => {
  const outsideDir = path.join(tmpRoot, "outside-real");
  mkdirSync(outsideDir);
  symlinkSync(outsideDir, path.join(resultsDir, "live-link"));
  const candidate = path.join(resultsDir, "live-link", "evil.json");
  const result = runWrapper(candidate);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /passes through a symbolic link/);
  assert.deepEqual(readdirSync(outsideDir), []);
});

test("lexical escape outside the results directory is rejected", () => {
  const candidate = path.join(tmpRoot, "src", "evil.json");
  const result = runWrapper(candidate);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /resolves outside the load-test results directory/);
});

test("legitimate nested output path passes path validation (guard refuses next)", () => {
  const candidate = path.join(resultsDir, "sub", "ok.json");
  const result = runWrapper(candidate);
  assert.equal(result.status, 1);
  // The refusal must come from the disposable-database guard (no
  // DATABASE_URL is provided), proving the path itself validated
  // and that execution stopped before any probe or k6 launch.
  assert.match(result.stderr, /guard: DATABASE_URL is not set/);
  // Path validation creates nothing: the nested directory is only
  // created at spawn time, which is never reached.
  assert.equal(existsSync(path.join(resultsDir, "sub")), false);
});
