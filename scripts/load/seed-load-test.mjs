#!/usr/bin/env node
/**
 * Synthetic-data seed generator for LOCAL load testing
 * (scripts/load/seed-load-test.mjs).
 *
 * Creates a realistic multi-tenant dataset — by default 14 gyms and
 * ~1,700 members with memberships, confirmed payments, payment claims,
 * 90 days of attendance history, and a small set of ready-to-use member
 * sessions for load actors — in a disposable local database.
 *
 * Safety (see scripts/load/guard.mjs for the full policy):
 * - The database target must pass the strict disposable-database guard
 *   (gymsaas_load* naming, loopback host only, no target-overriding
 *   query parameters, and LOAD_TEST_CONFIRM_DATABASE exactly matching
 *   the database name) BEFORE any connection is made.
 * - The database must contain ONLY load-test tenants: seeding refuses
 *   to run if any organization not named "Load Test Gym …" exists, and
 *   refuses to re-seed over an existing load-test dataset (use
 *   --cleanup first).
 * - All data is synthetic. Member phones are generated in a reserved
 *   pattern (91 + gym + member sequence) and belong to no real person.
 *
 * Session strategy (no Clerk, no APITxT, no OTP anywhere):
 * member sessions are inserted directly as rows in member_sessions,
 * exactly as the member linking flow creates them — the raw token is
 * generated here, only its SHA-256 hash is stored, and the raw tokens
 * for the actor subset are written to scripts/load/actors.local.json
 * (gitignored) for the k6 scripts to present as the gym_member_session
 * cookie. Staff/Clerk sessions are never fabricated: Clerk paths are
 * out of scope for these scripts.
 *
 * Usage:
 *   DATABASE_URL=postgres://…@localhost:5432/gymsaas_load_local \
 *   LOAD_TEST_CONFIRM_DATABASE=gymsaas_load_local \
 *     node scripts/load/seed-load-test.mjs [--cleanup]
 *
 * The target database must already be migrated
 * (`npx prisma migrate deploy` with the same DATABASE_URL).
 *
 * Scale knobs (defaults reproduce the audit target):
 *   LOAD_GYMS (default 14), LOAD_MEMBERS_PER_GYM (default: varied
 *   118–127 per gym, ~1,700 total), LOAD_ACTORS_PER_GYM (default 2),
 *   LOAD_ATTENDANCE_DAYS (default 90).
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { assertLoadTestDatabase } from "./guard.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ACTORS_FILE = path.join(SCRIPT_DIR, "actors.local.json");
const ORG_NAME_PREFIX = "Load Test Gym ";

const REQUIRED_TABLES = [
  "organizations",
  "users",
  "organization_memberships",
  "members",
  "memberships",
  "payments",
  "payment_claims",
  "attendance_sessions",
  "member_sessions",
];

function fail(message) {
  console.error(`seed-load-test: ${message}`);
  process.exit(1);
}

// Deterministic RNG (mulberry32) so dataset shapes are reproducible run
// to run; only session tokens use real randomness.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261018);
const randInt = (min, max) => min + Math.floor(rand() * (max - min + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

// Mirror of src/lib/members.ts addCalendarMonths: month arithmetic with
// the day clamped to the target month's last day, so seeded expiry
// dates match what the application itself derives.
function addCalendarMonths(utcDate, months) {
  const year = utcDate.getUTCFullYear();
  const month = utcDate.getUTCMonth() + months;
  const targetYear = Math.floor(year + month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(utcDate.getUTCDate(), lastDay);
  return new Date(Date.UTC(targetYear, targetMonth, day));
}
const PLAN_MONTHS = { MONTHLY: 1, THREE_MONTHS: 3, SIX_MONTHS: 6, TWELVE_MONTHS: 12 };
const PLAN_FEES = { MONTHLY: "800.00", THREE_MONTHS: "2100.00", SIX_MONTHS: "3900.00", TWELVE_MONTHS: "6900.00" };
const PLAN_ROTATION = [
  "MONTHLY", "MONTHLY", "MONTHLY", "MONTHLY", "MONTHLY",
  "THREE_MONTHS", "THREE_MONTHS", "THREE_MONTHS",
  "SIX_MONTHS", "TWELVE_MONTHS",
];
const PAYMENT_METHODS = ["UPI", "UPI", "UPI", "CASH", "CASH", "CARD"];

const FIRST_NAMES = [
  "Aarav", "Vihaan", "Arjun", "Kabir", "Ananya", "Diya", "Ishita", "Meera",
  "Rohan", "Priya", "Karan", "Sneha", "Aditya", "Kavya", "Nikhil", "Pooja",
  "Rahul", "Divya", "Vikram", "Shreya", "Manav", "Anjali", "Varun", "Neha",
];
const LAST_NAMES = [
  "Sharma", "Verma", "Patel", "Iyer", "Reddy", "Khan", "Das", "Nair",
  "Gupta", "Mehta", "Singh", "Rao", "Joshi", "Pillai", "Chopra", "Menon",
];

// Today in Asia/Kolkata as a UTC-midnight Date (dates in the schema are
// @db.Date / timestamptz; the app reasons about "today" in IST).
function kolkataTodayUtc() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
}
const toDateOnly = (d) => d.toISOString().slice(0, 10);
const addDays = (d, days) => new Date(d.getTime() + days * 86_400_000);

async function bulkInsert(client, table, columns, rows, batchSize = 500) {
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const params = [];
    const tuples = batch.map((row) => {
      const placeholders = row.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    await client.query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${tuples.join(", ")}`,
      params,
    );
  }
}

function parsePositiveIntEnv(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(`environment variable ${name} must be an integer between ${min} and ${max} (got "${raw}").`);
  }
  return value;
}

async function main() {
  const cleanup = process.argv.includes("--cleanup");
  let database;
  try {
    database = assertLoadTestDatabase();
  } catch (error) {
    fail(error.message);
  }
  const { databaseUrl, databaseName } = database;

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    // The schema must already be migrated; fail with guidance rather
    // than a raw relation-does-not-exist error.
    const { rows: tableRows } = await client.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [REQUIRED_TABLES],
    );
    if (tableRows.length !== REQUIRED_TABLES.length) {
      fail(
        `database "${databaseName}" is missing application tables — run ` +
          "`npx prisma migrate deploy` against it first (no data was written).",
      );
    }

    if (cleanup) {
      await runCleanup(client, databaseName);
      return;
    }
    await runSeed(client, databaseName);
  } finally {
    await client.end();
  }
}

async function runCleanup(client, databaseName) {
  await client.query("BEGIN");
  try {
    // Same exclusivity rule as seeding: cleanup deletes users, and a
    // user deletion cascades that user's organization memberships in
    // ANY organization — so refuse if the database holds tenants that
    // are not load-test organizations.
    const { rows: totals } = await client.query(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE name LIKE $1)::int AS load_orgs
       FROM organizations`,
      [`${ORG_NAME_PREFIX}%`],
    );
    if (totals[0].total !== totals[0].load_orgs) {
      throw new Error(
        "this database contains organizations that are not load-test tenants — " +
          "refusing to clean up a shared database (nothing was deleted).",
      );
    }
    const { rows: orgs } = await client.query(
      `SELECT id FROM organizations WHERE name LIKE $1`,
      [`${ORG_NAME_PREFIX}%`],
    );
    if (orgs.length === 0) {
      await client.query("ROLLBACK");
      console.log(`cleanup: no load-test organizations found in "${databaseName}" — nothing to do.`);
      return;
    }
    const orgIds = orgs.map((r) => r.id);
    const { rows: userRows } = await client.query(
      `SELECT DISTINCT user_id AS id FROM organization_memberships WHERE organization_id = ANY($1)
       UNION
       SELECT user_id AS id FROM members WHERE organization_id = ANY($1) AND user_id IS NOT NULL`,
      [orgIds],
    );
    // Organization deletion cascades to memberships, members,
    // memberships (periods), payments, claims, attendance, OTP
    // challenges, member sessions, and join requests.
    await client.query(`DELETE FROM organizations WHERE id = ANY($1)`, [orgIds]);
    let usersDeleted = 0;
    if (userRows.length > 0) {
      const { rowCount } = await client.query(`DELETE FROM users WHERE id = ANY($1)`, [
        userRows.map((r) => r.id),
      ]);
      usersDeleted = rowCount;
    }
    await client.query("COMMIT");
    // Remove the actors file only if it belongs to THIS database —
    // it may hold sessions for a different load database's dataset.
    let actorsNote = "actors file left untouched";
    if (existsSync(ACTORS_FILE)) {
      try {
        const parsed = JSON.parse(readFileSync(ACTORS_FILE, "utf8"));
        if (parsed.databaseName === databaseName) {
          rmSync(ACTORS_FILE);
          actorsNote = "actors file removed";
        }
      } catch {
        // Unreadable actors file: leave it; the seed regenerates it.
      }
    }
    console.log(
      `cleanup: removed ${orgs.length} load-test organization(s) and ${usersDeleted} user(s) ` +
        `from "${databaseName}"; ${actorsNote}.`,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function runSeed(client, databaseName) {
  const gymCount = parsePositiveIntEnv("LOAD_GYMS", 14, 1, 40);
  const membersPerGymEnv = process.env.LOAD_MEMBERS_PER_GYM
    ? parsePositiveIntEnv("LOAD_MEMBERS_PER_GYM", 0, 1, 5000)
    : null;
  const actorsPerGym = parsePositiveIntEnv("LOAD_ACTORS_PER_GYM", 2, 0, 50);
  const attendanceDays = parsePositiveIntEnv("LOAD_ATTENDANCE_DAYS", 90, 1, 365);

  const today = kolkataTodayUtc();
  const totals = {
    organizations: 0, users: 0, members: 0, memberships: 0,
    payments: 0, paymentClaims: 0, attendanceSessions: 0, memberSessions: 0,
  };
  const actors = [];

  await client.query("BEGIN");
  try {
    // The target database must be exclusively load-test data.
    const { rows: existing } = await client.query(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE name LIKE $1)::int AS load_orgs
       FROM organizations`,
      [`${ORG_NAME_PREFIX}%`],
    );
    if (existing[0].load_orgs > 0) {
      fail(
        "this database already contains a load-test dataset — run with --cleanup " +
          "first (no data was written).",
      );
    }
    if (existing[0].total > 0) {
      fail(
        "this database contains organizations that are not load-test tenants — " +
          "refusing to seed into a shared database (no data was written).",
      );
    }

    for (let g = 0; g < gymCount; g++) {
      const gymNumber = g + 1;
      const organizationId = randomUUID();
      const memberTarget = membersPerGymEnv ?? 118 + ((g * 37) % 10);
      const now = new Date();

      await bulkInsert(client, "organizations",
        ["id", "name", "phone", "email", "address", "created_at", "updated_at"],
        [[organizationId, `${ORG_NAME_PREFIX}${String(gymNumber).padStart(2, "0")}`,
          null, null, null, now, now]]);
      totals.organizations += 1;

      // Staff: one owner + two staff, Clerk-shaped synthetic IDs
      // (never used against Clerk — staff paths are out of scope for
      // these scripts; the rows exist so payments/claims/attendance
      // have realistic actors).
      const staffUsers = [
        { id: randomUUID(), clerk: `user_loadtest_owner_${gymNumber}`, role: "OWNER" },
        { id: randomUUID(), clerk: `user_loadtest_staff_${gymNumber}_1`, role: "STAFF" },
        { id: randomUUID(), clerk: `user_loadtest_staff_${gymNumber}_2`, role: "STAFF" },
      ];
      await bulkInsert(client, "users",
        ["id", "clerk_user_id", "phone_number", "created_at", "updated_at"],
        staffUsers.map((u) => [u.id, u.clerk, null, now, now]));
      totals.users += staffUsers.length;

      const memberRows = [];
      const memberUserRows = [];
      const orgMembershipRows = staffUsers.map((u) => [
        randomUUID(), u.id, organizationId, u.role, now, now,
      ]);
      const membershipRows = [];
      const paymentRows = [];
      const claimRows = [];
      const attendanceRows = [];
      const sessionRows = [];

      for (let m = 0; m < memberTarget; m++) {
        const memberIndex = m + 1;
        const phone =
          "91" +
          String(gymNumber).padStart(2, "0") +
          String(memberIndex).padStart(6, "0");
        const userId = randomUUID();
        const memberId = randomUUID();
        const name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
        memberUserRows.push([userId, null, phone, now, now]);
        orgMembershipRows.push([randomUUID(), userId, organizationId, "MEMBER", now, now]);
        memberRows.push([memberId, organizationId, userId, name, phone, now, now]);

        // Current membership period (valid today, so actor members can
        // check in): started 0–25 days ago, expiry derived exactly as
        // the application derives it.
        const plan = PLAN_ROTATION[m % PLAN_ROTATION.length];
        const fee = PLAN_FEES[plan];
        const startDate = addDays(today, -randInt(0, 25));
        const expiryDate = addCalendarMonths(startDate, PLAN_MONTHS[plan]);
        const membershipId = randomUUID();
        membershipRows.push([
          membershipId, organizationId, memberId, plan,
          toDateOnly(startDate), toDateOnly(expiryDate), fee, now, now,
        ]);

        // ~22% also carry an expired prior period.
        if (rand() < 0.22) {
          const priorStart = addCalendarMonths(startDate, -1);
          const priorExpiry = addDays(startDate, -1);
          membershipRows.push([
            randomUUID(), organizationId, memberId, "MONTHLY",
            toDateOnly(priorStart), toDateOnly(priorExpiry), PLAN_FEES.MONTHLY, now, now,
          ]);
        }

        // Payment shape for the current period: a confirmed claim
        // (with its linked payment), a direct full/partial payment, or
        // nothing yet.
        const staffActor = staffUsers[1].id;
        const shape = rand();
        const feeNumber = Number(fee);
        const paymentAt = new Date(addDays(startDate, randInt(0, 3)).getTime() + 10 * 3_600_000);
        if (shape < 0.1) {
          const claimId = randomUUID();
          claimRows.push([
            claimId, organizationId, memberId, membershipId, fee, "UPI",
            `UTR${randInt(100000000000, 999999999999)}`, "CONFIRMED",
            paymentAt, staffActor, now, now,
          ]);
          paymentRows.push([
            randomUUID(), organizationId, memberId, membershipId, fee, "UPI",
            `UTR${randInt(100000000000, 999999999999)}`, paymentAt, staffActor,
            claimId, null, now, now,
          ]);
        } else if (shape < 0.65) {
          const method = pick(PAYMENT_METHODS);
          paymentRows.push([
            randomUUID(), organizationId, memberId, membershipId, fee, method,
            method === "UPI" ? `UTR${randInt(100000000000, 999999999999)}` : null,
            paymentAt, staffActor, null, null, now, now,
          ]);
        } else if (shape < 0.8) {
          const partial = (feeNumber * (0.4 + rand() * 0.4)).toFixed(2);
          const method = pick(PAYMENT_METHODS);
          paymentRows.push([
            randomUUID(), organizationId, memberId, membershipId, partial, method,
            null, paymentAt, staffActor, null, null, now, now,
          ]);
        }
        // Independent pending / rejected claims on top of the above.
        const extraClaim = rand();
        if (extraClaim < 0.12) {
          claimRows.push([
            randomUUID(), organizationId, memberId, membershipId,
            (feeNumber * 0.5).toFixed(2), "UPI", null, "PENDING",
            null, null, now, now,
          ]);
        } else if (extraClaim < 0.17) {
          claimRows.push([
            randomUUID(), organizationId, memberId, membershipId,
            fee, "CASH", null, "REJECTED", paymentAt, staffActor, now, now,
          ]);
        }

        // Attendance history: each past day, ~35% attendance, check-in
        // between 06:00 and 20:45 IST for 40–100 minutes. History is
        // fully checked out (no open sessions) so the smoke test's
        // live check-in starts from a clean state.
        for (let d = 1; d <= attendanceDays; d++) {
          if (rand() >= 0.35) continue;
          const day = addDays(today, -d);
          const minuteOfDay = randInt(360, 1245);
          const checkIn = new Date(day.getTime() + (minuteOfDay - 330) * 60_000);
          const checkOut = new Date(checkIn.getTime() + randInt(40, 100) * 60_000);
          const viaQr = rand() < 0.6;
          attendanceRows.push([
            randomUUID(), organizationId, memberId,
            viaQr ? userId : staffUsers[2].id,
            viaQr ? "QR" : "MANUAL", checkIn.toISOString(), checkOut.toISOString(),
            now, now,
          ]);
        }

        // Load actors: the first N members of each gym get a live
        // member session (hash stored; raw token to the actors file).
        // Rows are collected here and inserted after the users/members
        // bulk inserts below, so the session foreign keys resolve.
        if (m < actorsPerGym) {
          const rawToken = randomBytes(32).toString("base64url");
          const tokenHash = createHash("sha256").update(rawToken).digest("hex");
          sessionRows.push([randomUUID(), userId, organizationId, tokenHash,
            new Date(now.getTime() + 30 * 86_400_000), now, null, now, now]);
          totals.memberSessions += 1;
          actors.push({
            gymId: organizationId,
            gymName: `${ORG_NAME_PREFIX}${String(gymNumber).padStart(2, "0")}`,
            memberId, userId, phone, token: rawToken,
          });
        }
      }

      await bulkInsert(client, "users",
        ["id", "clerk_user_id", "phone_number", "created_at", "updated_at"], memberUserRows);
      totals.users += memberUserRows.length;
      await bulkInsert(client, "organization_memberships",
        ["id", "user_id", "organization_id", "role", "created_at", "updated_at"], orgMembershipRows);
      await bulkInsert(client, "members",
        ["id", "organization_id", "user_id", "name", "phone_number", "created_at", "updated_at"], memberRows);
      totals.members += memberRows.length;
      await bulkInsert(client, "member_sessions",
        ["id", "user_id", "organization_id", "token_hash", "expires_at",
         "last_seen_at", "revoked_at", "created_at", "updated_at"], sessionRows);
      await bulkInsert(client, "memberships",
        ["id", "organization_id", "member_id", "plan", "start_date", "expiry_date", "fee", "created_at", "updated_at"], membershipRows);
      totals.memberships += membershipRows.length;
      // Claims insert before payments: claim-linked payments reference
      // their claim through the composite foreign key.
      await bulkInsert(client, "payment_claims",
        ["id", "organization_id", "member_id", "membership_id", "claimed_amount", "payment_method",
         "reference", "status", "verified_at", "verified_by", "created_at", "updated_at"], claimRows);
      totals.paymentClaims += claimRows.length;
      await bulkInsert(client, "payments",
        ["id", "organization_id", "member_id", "membership_id", "amount", "payment_method",
         "reference", "confirmed_at", "confirmed_by", "payment_claim_id", "idempotency_key",
         "created_at", "updated_at"], paymentRows);
      totals.payments += paymentRows.length;
      await bulkInsert(client, "attendance_sessions",
        ["id", "organization_id", "member_id", "checked_in_by", "source",
         "check_in_at", "check_out_at", "created_at", "updated_at"], attendanceRows);
      totals.attendanceSessions += attendanceRows.length;

      console.log(
        `seed: gym ${gymNumber}/${gymCount} — ${memberRows.length} members, ` +
          `${attendanceRows.length} attendance rows`,
      );
    }

    // Consistency assertions (inside the transaction: any failure
    // rolls the whole seed back rather than leaving a partial dataset).
    const checks = [];
    const crossTenant = await client.query(
      `SELECT count(*)::int AS n FROM payments p
         JOIN members m ON m.id = p.member_id
        WHERE m.organization_id <> p.organization_id`,
    );
    checks.push(["payments referencing a member of another gym", crossTenant.rows[0].n, 0]);
    const claimLinks = await client.query(
      `SELECT
         (SELECT count(*)::int FROM payment_claims WHERE status = 'CONFIRMED') AS confirmed_claims,
         (SELECT count(*)::int FROM payments WHERE payment_claim_id IS NOT NULL) AS linked_payments`,
    );
    checks.push([
      "confirmed claims == claim-linked payments",
      claimLinks.rows[0].linked_payments,
      claimLinks.rows[0].confirmed_claims,
    ]);
    const openSessions = await client.query(
      `SELECT count(*)::int AS n FROM attendance_sessions WHERE check_out_at IS NULL`,
    );
    checks.push(["open attendance sessions after seeding", openSessions.rows[0].n, 0]);
    for (const [label, actual, expected] of checks) {
      if (actual !== expected) {
        throw new Error(`consistency check failed: ${label} — expected ${expected}, got ${actual}`);
      }
    }

    await client.query("COMMIT");

    writeFileSync(
      ACTORS_FILE,
      JSON.stringify(
        { version: 1, databaseName, generatedAt: new Date().toISOString(), actors },
        null,
        2,
      ) + "\n",
    );

    console.log(
      `seed: complete in "${databaseName}" — ` +
        `${totals.organizations} gyms, ${totals.members} members, ` +
        `${totals.memberships} memberships, ${totals.payments} payments, ` +
        `${totals.paymentClaims} claims, ${totals.attendanceSessions} attendance rows, ` +
        `${totals.memberSessions} actor sessions.`,
    );
    console.log(`seed: actors written to ${ACTORS_FILE} (tokens are not printed; treat the file as a credential for synthetic local accounts only).`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

main().catch((error) => {
  fail(error.message ?? String(error));
});
