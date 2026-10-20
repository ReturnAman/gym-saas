/**
 * run-peak.test.mjs — persistent regression tests for the peak
 * wrapper's fail-closed safety behaviour.
 *
 * Black-box: each test copies the wrapper + guard (+ the peak
 * scenario file) into a temporary directory (the wrapper anchors
 * every path to its own location, so the copy is fully functional),
 * builds fixtures in the COPY's tree — never in the real one — and
 * spawns the copied wrapper.
 *
 * This can never run a load test, by construction:
 *   - the export-path and guard tests run with an environment that
 *     contains NO DATABASE_URL and NO LOAD_TEST_CONFIRM_DATABASE
 *     (or a deliberately invalid one), so the disposable-database
 *     guard refuses before any probe or spawn — the
 *     legitimate-path control case asserts exactly that guard
 *     refusal as its expected outcome;
 *   - the guard is pure string validation and fires before any
 *     connection attempt, so no database is ever contacted;
 *   - the BASE_URL tests use --print-config, which returns before
 *     any probe;
 *   - the exit-code test DOES let the wrapper pass its gates, but
 *     against test doubles only: a stub loopback HTTP responder
 *     stands in for the application (health + session-probe
 *     endpoints) and a fake `k6` shell script — placed first on
 *     PATH inside the temporary tree — stands in for the load
 *     generator. No real application, database, or k6 is involved.
 *
 * Run with:  node --test scripts/load/run-peak.test.mjs
 * (Node 20's built-in test runner; no dependencies.)
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const REAL_SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

/** A disposable-database identity that satisfies the guard: the
 * gymsaas_load naming allowlist, a loopback host, and a matching
 * explicit confirmation. Used only as STRINGS — the guard validates
 * them without contacting any database, and no server listens
 * anywhere for them. */
const FIXTURE_DATABASE_URL =
  "postgres://postgres@127.0.0.1:5432/gymsaas_load_fixture";
const FIXTURE_DATABASE_NAME = "gymsaas_load_fixture";

let tmpRoot;
let wrapperCopy;
let resultsDir;

function copyHarness(dir) {
  mkdirSync(path.join(dir, "k6"), { recursive: true });
  mkdirSync(path.join(dir, "results"), { recursive: true });
  for (const file of ["run-peak.mjs", "guard.mjs"]) {
    copyFileSync(path.join(REAL_SCRIPT_DIR, file), path.join(dir, file));
  }
  copyFileSync(
    path.join(REAL_SCRIPT_DIR, "k6", "peak.js"),
    path.join(dir, "k6", "peak.js"),
  );
  return path.join(dir, "run-peak.mjs");
}

before(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "run-peak-test-"));
  wrapperCopy = copyHarness(tmpRoot);
  resultsDir = path.join(tmpRoot, "results");
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

/** Spawn the copied wrapper for one --out candidate. Deliberately
 * passes NO database URL or confirmation: the disposable-database
 * guard must be the last line of refusal for any case the path
 * validator accepts, so k6 can never launch from these tests. */
function runWrapperOutOnly(outPath) {
  return spawnSync(
    process.execPath,
    [wrapperCopy, "--print-config", "--out", outPath],
    {
      cwd: tmpRoot,
      env: { PATH: process.env.PATH },
      encoding: "utf8",
    },
  );
}

test("dangling directory symlink with a nested output path is rejected", () => {
  const outsideTarget = path.join(tmpRoot, "outside-not-created");
  symlinkSync(outsideTarget, path.join(resultsDir, "dangle"));
  const candidate = path.join(resultsDir, "dangle", "evil.json");
  const result = runWrapperOutOnly(candidate);
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
  const result = runWrapperOutOnly(candidate);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /is a symbolic link/);
});

test("live symlinked subdirectory is rejected", () => {
  const outsideDir = path.join(tmpRoot, "outside-real");
  mkdirSync(outsideDir);
  symlinkSync(outsideDir, path.join(resultsDir, "live-link"));
  const candidate = path.join(resultsDir, "live-link", "evil.json");
  const result = runWrapperOutOnly(candidate);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /passes through a symbolic link/);
  assert.deepEqual(readdirSync(outsideDir), []);
});

test("lexical escape outside the results directory is rejected", () => {
  const candidate = path.join(tmpRoot, "src", "evil.json");
  const result = runWrapperOutOnly(candidate);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /resolves outside the load-test results directory/,
  );
});

test("legitimate nested output path passes path validation (guard refuses next)", () => {
  const candidate = path.join(resultsDir, "sub", "ok.json");
  const result = runWrapperOutOnly(candidate);
  assert.equal(result.status, 1);
  // The refusal must come from the disposable-database guard (no
  // DATABASE_URL is provided), proving the path itself validated
  // and that execution stopped before any probe or k6 launch.
  assert.match(result.stderr, /guard: DATABASE_URL is not set/);
  // Path validation creates nothing: the nested directory is only
  // created at spawn time, which is never reached.
  assert.equal(existsSync(path.join(resultsDir, "sub")), false);
});

test("guard refuses a production-like database name before any contact", () => {
  const result = spawnSync(
    process.execPath,
    [wrapperCopy, "--print-config"],
    {
      cwd: tmpRoot,
      env: {
        PATH: process.env.PATH,
        DATABASE_URL: "postgres://postgres@127.0.0.1:5432/gymsaas_load_prod",
        LOAD_TEST_CONFIRM_DATABASE: "gymsaas_load_prod",
      },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 1);
  // The denied-segment rule fires on the name itself; the guard's
  // message states that no database was contacted.
  assert.match(
    result.stderr,
    /guard: DATABASE_URL database "gymsaas_load_prod" contains the denied segment "prod"/,
  );
  assert.match(result.stderr, /no database was contacted/);
});

test("guard refuses when the confirmation does not match the database name", () => {
  const result = spawnSync(
    process.execPath,
    [wrapperCopy, "--print-config"],
    {
      cwd: tmpRoot,
      env: {
        PATH: process.env.PATH,
        DATABASE_URL: FIXTURE_DATABASE_URL,
        LOAD_TEST_CONFIRM_DATABASE: "gymsaas_load_other",
      },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /guard: LOAD_TEST_CONFIRM_DATABASE/);
});

test("non-loopback BASE_URL is refused after the guard passes", () => {
  const result = spawnSync(
    process.execPath,
    [wrapperCopy, "--print-config"],
    {
      cwd: tmpRoot,
      env: {
        PATH: process.env.PATH,
        DATABASE_URL: FIXTURE_DATABASE_URL,
        LOAD_TEST_CONFIRM_DATABASE: FIXTURE_DATABASE_NAME,
        BASE_URL: "http://192.0.2.10:3000",
      },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /is not loopback/);
});

test("loopback BASE_URL passes target validation (actors check refuses next)", () => {
  const result = spawnSync(
    process.execPath,
    [wrapperCopy, "--print-config"],
    {
      cwd: tmpRoot,
      env: {
        PATH: process.env.PATH,
        DATABASE_URL: FIXTURE_DATABASE_URL,
        LOAD_TEST_CONFIRM_DATABASE: FIXTURE_DATABASE_NAME,
        // Loopback with nothing listening: --print-config returns
        // before any probe, so no connection is ever attempted.
        BASE_URL: "http://127.0.0.1:9",
      },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 1);
  // Reaching the actors-file refusal proves the guard AND the
  // BASE_URL validation both passed, in that order — and that the
  // run stopped before any probe or k6 launch (this tree has no
  // actors file).
  assert.match(result.stderr, /actors file not found/);
});

test(
  "k6 exit code propagates through the wrapper (stub app + fake k6)",
  { timeout: 30_000 },
  async () => {
    const tree = mkdtempSync(path.join(os.tmpdir(), "run-peak-exit-"));
    const copiedWrapper = copyHarness(tree);

    // Seeded-actor fixture the wrapper's binding probe will use.
    writeFileSync(
      path.join(tree, "actors.local.json"),
      JSON.stringify({
        version: 1,
        databaseName: FIXTURE_DATABASE_NAME,
        generatedAt: "2026-01-01T00:00:00.000Z",
        actors: [
          {
            gymId: "gym-fixture",
            gymName: "Fixture Gym",
            memberId: "member-fixture",
            userId: "user-fixture",
            phone: "910000000000",
            token: "fixture-token",
          },
        ],
      }),
    );

    // Fake k6: reports its arguments, then exits with a distinctive
    // code the wrapper must propagate unchanged.
    const binDir = path.join(tree, "bin");
    mkdirSync(binDir);
    const fakeK6 = path.join(binDir, "k6");
    writeFileSync(fakeK6, '#!/bin/sh\necho "FAKE_K6_ARGS:$@"\nexit 43\n');
    chmodSync(fakeK6, 0o755);

    // Stub application: health + the session-probe page, on an
    // ephemeral loopback port.
    const server = http.createServer((req, res) => {
      if (req.url === "/api/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ service: "gym-saas", status: "ok" }));
      } else if (req.url === "/member/payments") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("payments");
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();

    try {
      const outcome = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [copiedWrapper], {
          cwd: tree,
          env: {
            PATH: `${binDir}:${process.env.PATH}`,
            DATABASE_URL: FIXTURE_DATABASE_URL,
            LOAD_TEST_CONFIRM_DATABASE: FIXTURE_DATABASE_NAME,
            BASE_URL: `http://127.0.0.1:${port}`,
          },
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => (stderr += chunk));
        child.on("error", reject);
        child.on("exit", (code) => resolve({ code, stdout, stderr }));
      });

      // Every gate passed (the binding probe accepted the stub app)…
      assert.match(outcome.stdout, /app confirmed against database/);
      // …the fake k6 was invoked on the peak scenario with the
      // default export contained in the copied results tree…
      const argsLine = outcome.stdout
        .split("\n")
        .find((line) => line.startsWith("FAKE_K6_ARGS:"));
      assert.ok(argsLine, "fake k6 was invoked");
      assert.match(argsLine, /^FAKE_K6_ARGS:run /);
      assert.ok(argsLine.includes(path.join("k6", "peak.js")));
      assert.ok(
        argsLine.includes(
          `--out json=${path.join(tree, "results", "k6-peak.json")}`,
        ),
      );
      // …and its exit code reached the wrapper's caller unchanged.
      assert.equal(outcome.code, 43);
    } finally {
      server.close();
      rmSync(tree, { recursive: true, force: true });
    }
  },
);
