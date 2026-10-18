#!/usr/bin/env node
/**
 * Runner for the migration upgrade-path test (Phase B).
 *
 * Why this exists: every other database check in this repository migrates
 * an EMPTY database, so the path a real deployment actually travels —
 * applying new migrations on top of the previous release's populated
 * schema — was never exercised anywhere (2026-10-14 production-readiness
 * audit). This runner performs that upgrade against a disposable
 * database and proves representative pre-existing data survives it:
 *
 *   1. Apply the pinned baseline release's migrations.
 *   2. Assert the applied set is exactly the baseline set.
 *   3. Seed a small synthetic fixture at the baseline schema
 *      (scripts/upgrade-test/seed-baseline.sql).
 *   4. Apply HEAD's migrations to the SAME database (no recreate/reseed).
 *   5. Assert the applied set is exactly HEAD's set, the seeded rows
 *      survive byte-identical, their foreign keys resolve, and the
 *      member_join_requests resulting-member FK is ON DELETE RESTRICT.
 *   6. Run the database suites (npm run test:db) against the upgraded
 *      database.
 *
 * Safety: the runner refuses to run before ANY database contact unless
 * DATABASE_URL satisfies a strict disposable-database policy, all of
 * it pure string validation — a substring check on the name is NOT
 * sufficient, because a production database could contain any
 * substring. The policy, in order: DATABASE_URL must be set; it must
 * parse with a postgres: or postgresql: protocol; the database name
 * must match the anchored convention `gymsaas_upgrade` optionally
 * followed by lowercase alphanumeric underscore segments; no name
 * segment may be a production-like word (prod, production, live,
 * pilot, staging, customer, real); the host must be loopback
 * (localhost, 127.0.0.1, ::1) — the only approved targets are the
 * local throwaway cluster and the CI postgres service, both reached
 * via loopback in this project's setup; no query parameter may
 * override the connection target (the pg driver honours a `host`
 * query parameter over the URL's own host — verified against the
 * installed pg-connection-string); and the operator must opt in
 * explicitly with UPGRADE_TEST_CONFIRM_DATABASE set to exactly the
 * parsed database name — a database name alone is never proof of
 * disposability. Every stage fails closed with a stage-labelled
 * error: like run-db-tests.mjs, failures throw and the top-level
 * handler sets a nonzero exit code (never process.exit mid-flow).
 *
 * Inputs (environment):
 *   DATABASE_URL  required; must satisfy the disposable-database
 *                 policy described under Safety above.
 *   UPGRADE_TEST_CONFIRM_DATABASE  required; must exactly equal the
 *                 database name parsed from DATABASE_URL (explicit
 *                 operator confirmation of the disposable target).
 *   BASELINE_DIR  required; a checkout/extraction of UPGRADE_BASELINE_REF.
 *   HEAD_DIR      optional; defaults to this repository's root. Exists so
 *                 a negative control can point at a scratch tree holding
 *                 a deliberately broken migration copy.
 *
 * Baseline migrations are applied with THIS checkout's Prisma CLI
 * (`npx prisma migrate deploy --schema <BASELINE_DIR>/prisma/schema.prisma`,
 * run from the repository root): Prisma resolves the migrations directory
 * relative to the schema file and the --schema flag overrides the schema
 * declared in prisma.config.ts — verified empirically in the local
 * rehearsal, so no second `npm ci` in the baseline tree is needed.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

// The previous release this rehearsal upgrades FROM.
//
// Maintenance rule: when a release is pushed, advance this pin to that
// release's commit in the same change that would otherwise be
// unverifiable — the pin moves exactly one line per release. The CI job
// checks out this same ref into upgrade-baseline/ (BASELINE_DIR).
const UPGRADE_BASELINE_REF = "a046fcb5a886f1405b55af7a5fd090c19d7d6af1";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const seedFile = path.join(repoRoot, "scripts", "upgrade-test", "seed-baseline.sql");

// Expected fixture values, defined INDEPENDENTLY of seed-baseline.sql on
// purpose: the duplication is the check. If the seed file and this block
// ever disagree, the rehearsal fails loudly instead of drifting.
const EXPECTED = {
  organization: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Upgrade Path Test Gym",
    phone: null,
    email: null,
    address: null,
  },
  ownerUser: {
    id: "22222222-2222-4222-8222-222222222222",
    clerkUserId: "user_upgrade_path_test",
    phoneNumber: null,
  },
  organizationMembership: {
    id: "33333333-3333-4333-8333-333333333333",
    role: "OWNER",
  },
  member: {
    id: "44444444-4444-4444-8444-444444444444",
    userId: null,
    name: "Upgrade Test Member",
    phoneNumber: "9000000001",
  },
  membership: {
    id: "55555555-5555-4555-8555-555555555555",
    plan: "MONTHLY",
    startDate: "2026-09-01",
    expiryDate: "2026-10-01",
    fee: "1500.00",
  },
  payment: {
    id: "66666666-6666-4666-8666-666666666666",
    amount: "1500.00",
    paymentMethod: "UPI",
    reference: null,
    confirmedAt: "2026-09-01T10:00:00Z",
    paymentClaimId: null,
    idempotencyKey: null,
  },
  paymentClaim: {
    id: "77777777-7777-4777-8777-777777777777",
    claimedAmount: "500.00",
    paymentMethod: "UPI",
    reference: "UTR-UPGRADE-TEST-001",
    status: "PENDING",
    verifiedAt: null,
    verifiedBy: null,
  },
  createdAt: "2026-09-01T09:00:00Z",
  updatedAt: "2026-09-01T09:00:00Z",
};

const RESULTING_MEMBER_FK = "member_join_requests_organization_id_resulting_member_id_fkey";
const TS = `to_char(%COL% AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

function fail(message) {
  throw new Error(message);
}

function migrationNames(dir, stageLabel) {
  const migrationsDir = path.join(dir, "prisma", "migrations");
  if (!existsSync(migrationsDir)) {
    fail(`${stageLabel}: no prisma/migrations directory under ${dir}.`);
  }
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function runMigrateDeploy(stageLabel, schemaPath) {
  console.log(`${stageLabel}: prisma migrate deploy --schema ${schemaPath}`);
  const child = spawnSync("npx", ["prisma", "migrate", "deploy", "--schema", schemaPath], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (child.error) {
    fail(`${stageLabel}: could not launch the Prisma CLI (${child.error.message}).`);
  }
  if (child.status !== 0) {
    fail(`${stageLabel}: prisma migrate deploy exited with status ${child.status}.`);
  }
}

async function assertMigrationSet(client, stageLabel, expectedNames) {
  const { rows } = await client.query(
    "SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations",
  );
  const unfinished = rows.filter((row) => row.finished_at === null || row.rolled_back_at !== null);
  if (unfinished.length > 0) {
    fail(
      `${stageLabel}: _prisma_migrations holds ${unfinished.length} unfinished/rolled-back ` +
        `row(s): ${unfinished.map((row) => row.migration_name).join(", ")}.`,
    );
  }
  const applied = rows.map((row) => row.migration_name).sort();
  const missing = expectedNames.filter((name) => !applied.includes(name));
  const extra = applied.filter((name) => !expectedNames.includes(name));
  if (missing.length > 0 || extra.length > 0) {
    fail(
      `${stageLabel}: applied migration set does not match the expected set. ` +
        `Missing: [${missing.join(", ")}]; unexpected: [${extra.join(", ")}].`,
    );
  }
  console.log(
    `${stageLabel}: ${applied.length} migrations applied and finished, exactly the expected set.`,
  );
  return applied.length;
}

function expectField(stageLabel, label, actual, expected) {
  if (actual !== expected) {
    fail(
      `upgrade assertions: ${label} — expected ${JSON.stringify(expected)}, ` +
        `found ${JSON.stringify(actual)}.`,
    );
  }
  console.log(`upgrade assertions: ${label} = ${JSON.stringify(actual)} ok (${stageLabel})`);
}

async function fetchSingleRow(client, stageLabel, label, sql, id) {
  const { rows } = await client.query(sql, [id]);
  if (rows.length !== 1) {
    fail(`upgrade assertions: ${label} — expected exactly 1 row, found ${rows.length}.`);
  }
  return rows[0];
}

async function assertSeedSurvived(client) {
  const stage = "seed survival";
  const E = EXPECTED;

  const org = await fetchSingleRow(
    client,
    stage,
    "organization",
    `SELECT id::text AS id, name, phone, email, address,
            ${TS.replace("%COL%", "created_at")} AS created_at,
            ${TS.replace("%COL%", "updated_at")} AS updated_at
       FROM organizations WHERE id = $1`,
    E.organization.id,
  );
  expectField(stage, "organization.name", org.name, E.organization.name);
  expectField(stage, "organization.phone", org.phone, E.organization.phone);
  expectField(stage, "organization.email", org.email, E.organization.email);
  expectField(stage, "organization.address", org.address, E.organization.address);
  expectField(stage, "organization.created_at", org.created_at, E.createdAt);
  expectField(stage, "organization.updated_at", org.updated_at, E.updatedAt);

  const user = await fetchSingleRow(
    client,
    stage,
    "owner user",
    `SELECT id::text AS id, clerk_user_id, phone_number,
            ${TS.replace("%COL%", "created_at")} AS created_at,
            ${TS.replace("%COL%", "updated_at")} AS updated_at
       FROM users WHERE id = $1`,
    E.ownerUser.id,
  );
  expectField(stage, "user.clerk_user_id", user.clerk_user_id, E.ownerUser.clerkUserId);
  expectField(stage, "user.phone_number", user.phone_number, E.ownerUser.phoneNumber);
  expectField(stage, "user.created_at", user.created_at, E.createdAt);
  expectField(stage, "user.updated_at", user.updated_at, E.updatedAt);

  const orgMembership = await fetchSingleRow(
    client,
    stage,
    "organization membership",
    `SELECT om.id::text AS id, om.user_id::text AS user_id,
            om.organization_id::text AS organization_id, om.role::text AS role,
            u.clerk_user_id AS joined_clerk_user_id, o.name AS joined_org_name,
            ${TS.replace("%COL%", "om.created_at")} AS created_at,
            ${TS.replace("%COL%", "om.updated_at")} AS updated_at
       FROM organization_memberships om
       JOIN users u ON u.id = om.user_id
       JOIN organizations o ON o.id = om.organization_id
      WHERE om.id = $1`,
    E.organizationMembership.id,
  );
  expectField(stage, "organization_membership.user_id", orgMembership.user_id, E.ownerUser.id);
  expectField(
    stage,
    "organization_membership.organization_id",
    orgMembership.organization_id,
    E.organization.id,
  );
  expectField(stage, "organization_membership.role", orgMembership.role, E.organizationMembership.role);
  expectField(
    stage,
    "organization_membership -> user.clerk_user_id",
    orgMembership.joined_clerk_user_id,
    E.ownerUser.clerkUserId,
  );
  expectField(
    stage,
    "organization_membership -> organization.name",
    orgMembership.joined_org_name,
    E.organization.name,
  );

  const member = await fetchSingleRow(
    client,
    stage,
    "member",
    `SELECT id::text AS id, organization_id::text AS organization_id,
            user_id::text AS user_id, name, phone_number,
            ${TS.replace("%COL%", "created_at")} AS created_at,
            ${TS.replace("%COL%", "updated_at")} AS updated_at
       FROM members WHERE id = $1`,
    E.member.id,
  );
  expectField(stage, "member.organization_id", member.organization_id, E.organization.id);
  expectField(stage, "member.user_id", member.user_id, E.member.userId);
  expectField(stage, "member.name", member.name, E.member.name);
  expectField(stage, "member.phone_number", member.phone_number, E.member.phoneNumber);
  expectField(stage, "member.created_at", member.created_at, E.createdAt);
  expectField(stage, "member.updated_at", member.updated_at, E.updatedAt);

  const membership = await fetchSingleRow(
    client,
    stage,
    "membership",
    `SELECT ms.id::text AS id, ms.organization_id::text AS organization_id,
            ms.member_id::text AS member_id, ms.plan::text AS plan,
            ms.start_date::text AS start_date, ms.expiry_date::text AS expiry_date,
            ms.fee::text AS fee,
            m.organization_id::text AS joined_member_org_id,
            ${TS.replace("%COL%", "ms.created_at")} AS created_at,
            ${TS.replace("%COL%", "ms.updated_at")} AS updated_at
       FROM memberships ms
       JOIN members m ON m.id = ms.member_id
      WHERE ms.id = $1`,
    E.membership.id,
  );
  expectField(stage, "membership.organization_id", membership.organization_id, E.organization.id);
  expectField(stage, "membership.member_id", membership.member_id, E.member.id);
  expectField(stage, "membership.plan", membership.plan, E.membership.plan);
  expectField(stage, "membership.start_date", membership.start_date, E.membership.startDate);
  expectField(stage, "membership.expiry_date", membership.expiry_date, E.membership.expiryDate);
  expectField(stage, "membership.fee", membership.fee, E.membership.fee);
  expectField(
    stage,
    "membership -> member.organization_id",
    membership.joined_member_org_id,
    E.organization.id,
  );
  expectField(stage, "membership.created_at", membership.created_at, E.createdAt);
  expectField(stage, "membership.updated_at", membership.updated_at, E.updatedAt);

  const payment = await fetchSingleRow(
    client,
    stage,
    "payment",
    `SELECT p.id::text AS id, p.organization_id::text AS organization_id,
            p.member_id::text AS member_id, p.membership_id::text AS membership_id,
            p.amount::text AS amount, p.payment_method::text AS payment_method,
            p.reference AS reference,
            ${TS.replace("%COL%", "p.confirmed_at")} AS confirmed_at,
            p.confirmed_by::text AS confirmed_by,
            p.payment_claim_id::text AS payment_claim_id,
            p.idempotency_key AS idempotency_key,
            ms.member_id::text AS joined_membership_member_id,
            ms.organization_id::text AS joined_membership_org_id,
            m.organization_id::text AS joined_member_org_id,
            ${TS.replace("%COL%", "p.created_at")} AS created_at,
            ${TS.replace("%COL%", "p.updated_at")} AS updated_at
       FROM payments p
       JOIN memberships ms ON ms.id = p.membership_id
       JOIN members m ON m.id = p.member_id
      WHERE p.id = $1`,
    E.payment.id,
  );
  expectField(stage, "payment.organization_id", payment.organization_id, E.organization.id);
  expectField(stage, "payment.member_id", payment.member_id, E.member.id);
  expectField(stage, "payment.membership_id", payment.membership_id, E.membership.id);
  expectField(stage, "payment.amount", payment.amount, E.payment.amount);
  expectField(stage, "payment.payment_method", payment.payment_method, E.payment.paymentMethod);
  expectField(stage, "payment.reference", payment.reference, E.payment.reference);
  expectField(stage, "payment.confirmed_at", payment.confirmed_at, E.payment.confirmedAt);
  expectField(stage, "payment.confirmed_by", payment.confirmed_by, E.ownerUser.id);
  expectField(stage, "payment.payment_claim_id", payment.payment_claim_id, E.payment.paymentClaimId);
  expectField(stage, "payment.idempotency_key", payment.idempotency_key, E.payment.idempotencyKey);
  expectField(
    stage,
    "payment -> membership.member_id",
    payment.joined_membership_member_id,
    E.member.id,
  );
  expectField(
    stage,
    "payment -> membership.organization_id",
    payment.joined_membership_org_id,
    E.organization.id,
  );
  expectField(stage, "payment -> member.organization_id", payment.joined_member_org_id, E.organization.id);
  expectField(stage, "payment.created_at", payment.created_at, E.createdAt);
  expectField(stage, "payment.updated_at", payment.updated_at, E.updatedAt);

  const claim = await fetchSingleRow(
    client,
    stage,
    "payment claim",
    `SELECT pc.id::text AS id, pc.organization_id::text AS organization_id,
            pc.member_id::text AS member_id, pc.membership_id::text AS membership_id,
            pc.claimed_amount::text AS claimed_amount,
            pc.payment_method::text AS payment_method, pc.reference AS reference,
            pc.status::text AS status,
            ${TS.replace("%COL%", "pc.verified_at")} AS verified_at,
            pc.verified_by::text AS verified_by,
            ms.member_id::text AS joined_membership_member_id,
            ms.organization_id::text AS joined_membership_org_id,
            m.organization_id::text AS joined_member_org_id,
            ${TS.replace("%COL%", "pc.created_at")} AS created_at,
            ${TS.replace("%COL%", "pc.updated_at")} AS updated_at
       FROM payment_claims pc
       JOIN memberships ms ON ms.id = pc.membership_id
       JOIN members m ON m.id = pc.member_id
      WHERE pc.id = $1`,
    E.paymentClaim.id,
  );
  expectField(stage, "payment_claim.organization_id", claim.organization_id, E.organization.id);
  expectField(stage, "payment_claim.member_id", claim.member_id, E.member.id);
  expectField(stage, "payment_claim.membership_id", claim.membership_id, E.membership.id);
  expectField(stage, "payment_claim.claimed_amount", claim.claimed_amount, E.paymentClaim.claimedAmount);
  expectField(stage, "payment_claim.payment_method", claim.payment_method, E.paymentClaim.paymentMethod);
  expectField(stage, "payment_claim.reference", claim.reference, E.paymentClaim.reference);
  expectField(stage, "payment_claim.status", claim.status, E.paymentClaim.status);
  expectField(stage, "payment_claim.verified_at", claim.verified_at, E.paymentClaim.verifiedAt);
  expectField(stage, "payment_claim.verified_by", claim.verified_by, E.paymentClaim.verifiedBy);
  expectField(
    stage,
    "payment_claim -> membership.member_id",
    claim.joined_membership_member_id,
    E.member.id,
  );
  expectField(
    stage,
    "payment_claim -> membership.organization_id",
    claim.joined_membership_org_id,
    E.organization.id,
  );
  expectField(stage, "payment_claim -> member.organization_id", claim.joined_member_org_id, E.organization.id);
  expectField(stage, "payment_claim.created_at", claim.created_at, E.createdAt);
  expectField(stage, "payment_claim.updated_at", claim.updated_at, E.updatedAt);

  // Exactly one row per seeded table: nothing duplicated, nothing lost.
  for (const table of [
    "organizations",
    "users",
    "organization_memberships",
    "members",
    "memberships",
    "payments",
    "payment_claims",
  ]) {
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${table}`);
    expectField(stage, `${table} row count`, rows[0].n, 1);
  }
}

async function assertJoinRequestShape(client) {
  const stage = "join-request shape";
  const { rows: tableRows } = await client.query(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'member_join_requests'`,
  );
  expectField(stage, "member_join_requests table exists (count)", tableRows[0].n, 1);

  const { rows: fkRows } = await client.query(
    "SELECT confdeltype FROM pg_constraint WHERE conname = $1",
    [RESULTING_MEMBER_FK],
  );
  if (fkRows.length !== 1) {
    fail(`upgrade assertions: constraint ${RESULTING_MEMBER_FK} — expected 1 row, found ${fkRows.length}.`);
  }
  expectField(stage, `${RESULTING_MEMBER_FK} confdeltype ('r' = RESTRICT)`, fkRows[0].confdeltype, "r");
}

// Disposable-database policy constants (see the Safety paragraph in the
// header). The name convention is anchored: exactly `gymsaas_upgrade`
// (the CI service database) or that prefix plus lowercase alphanumeric
// underscore segments (local rehearsal variants such as
// `gymsaas_upgrade_rehearsal`). Production-like words are denied as
// whole segments even inside an otherwise conforming name, and the only
// approved hosts are loopback — the local throwaway cluster and the CI
// postgres service are both reached via localhost in this project.
const DISPOSABLE_DB_NAME_PATTERN = /^gymsaas_upgrade(?:_[a-z0-9]+)*$/;
const DENIED_DB_NAME_SEGMENTS = ["prod", "production", "live", "pilot", "staging", "customer", "real"];
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "::1"];
// Query parameters that name or override the connection target. The
// installed pg driver (pg 8.23.0 / pg-connection-string 2.14.0, probed
// empirically) honours `host` — and copies `hostaddr` — from the query
// string OVER the URL's own authority, so a URL whose parsed hostname
// is loopback could still connect to a remote host. `database`/`dbname`
// name the target database itself. None of these may appear: the
// target the guard validated must be the target the driver uses.
const TARGET_OVERRIDE_QUERY_PARAMS = ["host", "hostaddr", "database", "dbname"];

try {
  // --- Guards: fail closed BEFORE any database contact. ---
  // Rules 1–7 are the disposable-database policy; every check is pure
  // string validation of DATABASE_URL and the confirmation marker, so
  // a rejection never resolves DNS, opens a socket, launches Prisma,
  // or connects — the first failed rule throws.
  //
  // Rule 1: DATABASE_URL must be set.
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    fail("guard: DATABASE_URL is not set — refusing to run (no database was contacted).");
  }
  // Rule 2: DATABASE_URL must parse and use a postgres protocol.
  let parsedUrl;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    fail("guard: DATABASE_URL could not be parsed — refusing to run (no database was contacted).");
  }
  if (parsedUrl.protocol !== "postgres:" && parsedUrl.protocol !== "postgresql:") {
    fail(
      `guard: DATABASE_URL protocol "${parsedUrl.protocol}" is not postgres: or postgresql: — ` +
        "refusing to run (no database was contacted).",
    );
  }
  let databaseName;
  try {
    databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ""));
  } catch {
    fail("guard: DATABASE_URL database name could not be decoded — refusing to run (no database was contacted).");
  }
  // Rule 3: the database name must match the anchored naming convention.
  if (!DISPOSABLE_DB_NAME_PATTERN.test(databaseName)) {
    fail(
      `guard: DATABASE_URL database "${databaseName}" does not match the disposable ` +
        "upgrade-test naming convention (gymsaas_upgrade, optionally followed by " +
        "lowercase alphanumeric underscore segments) — refusing to run. A name " +
        "merely containing \"upgrade\" is not sufficient (no database was contacted).",
    );
  }
  // Rule 4: no production-like segment anywhere in the name.
  const deniedSegment = databaseName.split("_").find((segment) => DENIED_DB_NAME_SEGMENTS.includes(segment));
  if (deniedSegment) {
    fail(
      `guard: DATABASE_URL database "${databaseName}" contains the denied segment ` +
        `"${deniedSegment}" — production-like databases are refused even when the ` +
        "rest of the name conforms (no database was contacted).",
    );
  }
  // Rule 5: the host must be loopback.
  const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!LOOPBACK_HOSTS.includes(hostname)) {
    fail(
      `guard: DATABASE_URL host "${parsedUrl.hostname}" is not loopback ` +
        "(localhost, 127.0.0.1, ::1) — the only approved targets are the local " +
        "throwaway cluster and the CI postgres service, both reached via " +
        "loopback (no database was contacted).",
    );
  }
  // Rule 6: no query parameter may override the connection target —
  // the pg driver honours a `host` query parameter over the URL's own
  // host (see TARGET_OVERRIDE_QUERY_PARAMS), so a loopback authority
  // alone does not establish where the driver will connect.
  for (const key of parsedUrl.searchParams.keys()) {
    if (TARGET_OVERRIDE_QUERY_PARAMS.includes(key.toLowerCase())) {
      fail(
        `guard: DATABASE_URL query parameter "${key}" can override the connection ` +
          "target and is not allowed — refusing to run (no database was contacted).",
      );
    }
  }
  // Rule 7: the operator must explicitly confirm this exact database.
  const confirmDatabase = process.env.UPGRADE_TEST_CONFIRM_DATABASE;
  if (!confirmDatabase) {
    fail(
      "guard: UPGRADE_TEST_CONFIRM_DATABASE is not set — the operator must explicitly " +
        "name the disposable database being confirmed; a database name alone is " +
        "never proof of disposability (no database was contacted).",
    );
  }
  if (confirmDatabase !== databaseName) {
    fail(
      `guard: UPGRADE_TEST_CONFIRM_DATABASE "${confirmDatabase}" does not exactly match ` +
        `the DATABASE_URL database "${databaseName}" — refusing to run ` +
        "(no database was contacted).",
    );
  }
  const baselineDirRaw = process.env.BASELINE_DIR;
  if (!baselineDirRaw) {
    fail("guard: BASELINE_DIR is not set — a checkout of the pinned baseline is required.");
  }
  const baselineDir = path.resolve(baselineDirRaw);
  const headDir = process.env.HEAD_DIR ? path.resolve(process.env.HEAD_DIR) : repoRoot;
  if (!existsSync(path.join(baselineDir, "prisma", "schema.prisma"))) {
    fail(`guard: BASELINE_DIR ${baselineDir} has no prisma/schema.prisma.`);
  }
  if (!existsSync(path.join(headDir, "prisma", "schema.prisma"))) {
    fail(`guard: HEAD_DIR ${headDir} has no prisma/schema.prisma.`);
  }
  if (!existsSync(seedFile)) {
    fail(`guard: seed file not found at ${seedFile}.`);
  }

  console.log(
    `upgrade test: baseline ${UPGRADE_BASELINE_REF} (${baselineDir}) -> HEAD (${headDir}) ` +
      `on database "${databaseName}".`,
  );

  const client = new pg.Client({ connectionString: databaseUrl });
  try {
    // --- Stage 1+2: baseline migrate, then assert the exact set. ---
    runMigrateDeploy("baseline migrate", path.join(baselineDir, "prisma", "schema.prisma"));
    await client.connect();
    const baselineCount = await assertMigrationSet(
      client,
      "baseline assertions",
      migrationNames(baselineDir, "baseline assertions"),
    );

    // --- Stage 3: seed the synthetic fixture at the baseline schema. ---
    await client.query(readFileSync(seedFile, "utf8"));
    console.log("seed: baseline fixture applied from scripts/upgrade-test/seed-baseline.sql.");

    // --- Stage 4+5: upgrade the SAME database, then assert everything. ---
    runMigrateDeploy("upgrade migrate", path.join(headDir, "prisma", "schema.prisma"));
    const headCount = await assertMigrationSet(
      client,
      "upgrade assertions",
      migrationNames(headDir, "upgrade assertions"),
    );
    await assertSeedSurvived(client);
    await assertJoinRequestShape(client);

    console.log(
      `upgrade assertions: migration count ${baselineCount} (baseline) -> ${headCount} (HEAD); ` +
        "all seeded data preserved.",
    );
  } finally {
    await client.end().catch(() => {});
  }

  // --- Stage 6: the database suites against the upgraded database. ---
  console.log("test:db: running the PostgreSQL integration suites against the upgraded database.");
  const testChild = spawnSync("npm", ["run", "test:db"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (testChild.error) {
    fail(`test:db: could not launch npm (${testChild.error.message}).`);
  }
  if (testChild.status !== 0) {
    fail(`test:db: npm run test:db exited with status ${testChild.status}.`);
  }

  console.log(
    "PASS: migration upgrade path verified — baseline applied, fixture seeded, " +
      "upgrade applied, data preserved, FK RESTRICT confirmed, test:db green.",
  );
} catch (error) {
  console.error(`upgrade test: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
