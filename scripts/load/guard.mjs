/**
 * Disposable-database guard for the local load-test tooling
 * (scripts/load/*). This module is the load-test analogue of the
 * upgrade-test guard in scripts/run-upgrade-test.mjs and implements the
 * same strict policy, adapted to the load-test naming convention:
 *
 *   A database is an approved load-test target only when ALL of these
 *   hold:
 *
 *   1. DATABASE_URL is set.
 *   2. It parses and uses a postgres: or postgresql: protocol.
 *   3. The database name matches /^gymsaas_load(?:_[a-z0-9]+)*$/ —
 *      an anchored convention; a name merely containing "load" is not
 *      sufficient.
 *   4. No underscore-separated segment of the name is one of the denied
 *      production-like words (prod, production, live, pilot, staging,
 *      customer, real) — denied even inside an otherwise conforming
 *      name, so `gymsaas_load_prod` is refused.
 *   5. The host is loopback (localhost, 127.0.0.1, ::1). This slice is
 *      LOCAL-ONLY: no remote database is ever an approved target.
 *   6. No query parameter may override the connection target. The
 *      installed pg driver (pg 8.23.0 / pg-connection-string 2.14.0,
 *      probed empirically during the Phase B upgrade-test work) honours
 *      a `host` query parameter — and copies `hostaddr` — OVER the
 *      URL's own authority, and `database`/`dbname` name the target
 *      database, so the target the guard validated must be the target
 *      the driver actually uses. `options` is refused too: the driver
 *      forwards it as server startup parameters (e.g. search_path),
 *      which could silently redirect unqualified table references to
 *      a different schema of the same database.
 *   7. LOAD_TEST_CONFIRM_DATABASE is set and exactly equals the parsed
 *      database name. A name alone is never proof of disposability; the
 *      operator explicitly confirms the exact database.
 *
 * Every check is pure string validation performed BEFORE any database
 * contact: a rejection never resolves DNS, opens a socket, or connects.
 * Violations throw an Error whose message starts with "guard:".
 */

const DISPOSABLE_DB_NAME_PATTERN = /^gymsaas_load(?:_[a-z0-9]+)*$/;
const DENIED_DB_NAME_SEGMENTS = [
  "prod",
  "production",
  "live",
  "pilot",
  "staging",
  "customer",
  "real",
];
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "::1"];
const TARGET_OVERRIDE_QUERY_PARAMS = ["host", "hostaddr", "database", "dbname", "options"];

function guardFail(message) {
  throw new Error(`guard: ${message} (no database was contacted)`);
}

/**
 * Validate DATABASE_URL + LOAD_TEST_CONFIRM_DATABASE from `env`.
 * Returns { databaseUrl, databaseName } on success; throws otherwise.
 */
export function assertLoadTestDatabase(env = process.env) {
  // Rule 1: DATABASE_URL must be set.
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    guardFail("DATABASE_URL is not set — refusing to run");
  }
  // Rule 2: must parse and use a postgres protocol.
  let parsedUrl;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    guardFail("DATABASE_URL could not be parsed — refusing to run");
  }
  if (parsedUrl.protocol !== "postgres:" && parsedUrl.protocol !== "postgresql:") {
    guardFail(
      `DATABASE_URL protocol "${parsedUrl.protocol}" is not postgres: or postgresql: — refusing to run`,
    );
  }
  let databaseName;
  try {
    databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ""));
  } catch {
    guardFail("DATABASE_URL database name could not be decoded — refusing to run");
  }
  // Rule 3: anchored naming convention.
  if (!DISPOSABLE_DB_NAME_PATTERN.test(databaseName)) {
    guardFail(
      `DATABASE_URL database "${databaseName}" does not match the disposable ` +
        "load-test naming convention (gymsaas_load, optionally followed by " +
        "lowercase alphanumeric underscore segments) — refusing to run. A name " +
        'merely containing "load" is not sufficient',
    );
  }
  // Rule 4: no production-like segment anywhere in the name.
  const deniedSegment = databaseName
    .split("_")
    .find((segment) => DENIED_DB_NAME_SEGMENTS.includes(segment));
  if (deniedSegment) {
    guardFail(
      `DATABASE_URL database "${databaseName}" contains the denied segment ` +
        `"${deniedSegment}" — production-like databases are refused even when ` +
        "the rest of the name conforms",
    );
  }
  // Rule 5: loopback hosts only (local-only slice).
  const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!LOOPBACK_HOSTS.includes(hostname)) {
    guardFail(
      `DATABASE_URL host "${parsedUrl.hostname}" is not loopback ` +
        "(localhost, 127.0.0.1, ::1) — this tooling is local-only and never " +
        "targets a remote database",
    );
  }
  // Rule 6: no query parameter may override the connection target.
  for (const key of parsedUrl.searchParams.keys()) {
    if (TARGET_OVERRIDE_QUERY_PARAMS.includes(key.toLowerCase())) {
      guardFail(
        `DATABASE_URL query parameter "${key}" can override the connection ` +
          "target and is not allowed — refusing to run",
      );
    }
  }
  // Rule 7: the operator must explicitly confirm this exact database.
  const confirmDatabase = env.LOAD_TEST_CONFIRM_DATABASE;
  if (!confirmDatabase) {
    guardFail(
      "LOAD_TEST_CONFIRM_DATABASE is not set — the operator must explicitly " +
        "name the disposable database being confirmed; a database name alone " +
        "is never proof of disposability",
    );
  }
  if (confirmDatabase !== databaseName) {
    guardFail(
      `LOAD_TEST_CONFIRM_DATABASE "${confirmDatabase}" does not exactly match ` +
        `the DATABASE_URL database "${databaseName}" — refusing to run`,
    );
  }
  return { databaseUrl, databaseName };
}

export { LOOPBACK_HOSTS };
