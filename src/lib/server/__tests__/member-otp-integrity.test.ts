import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const MIGRATION_SQL_PATH = path.join(
  repoRoot,
  "prisma/migrations/20261009010000_add_member_otp_challenges/migration.sql",
);
const SCHEMA_PATH = path.join(repoRoot, "prisma/schema.prisma");

/**
 * Member OTP challenge storage integrity.
 *
 * The provider generates and verifies the OTP — the database must never be
 * able to hold one. These coherence checks pin the migration/schema pair:
 * the challenges table exists with its tenant + rate-limit indexes, and it
 * has no OTP column and no member/user foreign keys (at request time the
 * phone is discovery only and no authenticated user exists).
 */
describe("member OTP challenge schema", () => {
  const migrationSql = readFileSync(MIGRATION_SQL_PATH, "utf8");
  const schema = readFileSync(SCHEMA_PATH, "utf8");

  it("creates the member_otp_challenges table", () => {
    expect(migrationSql).toMatch(/CREATE TABLE "member_otp_challenges"/);
    expect(schema).toMatch(/model MemberOtpChallenge/);
  });

  it("creates the tenant + rate-limit composite index", () => {
    expect(migrationSql).toMatch(
      /CREATE INDEX "member_otp_challenges_organization_id_phone_number_created_at_idx" ON "member_otp_challenges"\("organization_id", "phone_number", "created_at"\)/,
    );
    expect(schema).toMatch(
      /@@index\(\[organizationId, phoneNumber, createdAt\]\)/,
    );
  });

  it("has no column that could store an OTP", () => {
    const createTable = migrationSql.match(
      /CREATE TABLE "member_otp_challenges" \(([\s\S]*?)\);/,
    );
    expect(createTable).not.toBeNull();
    const body = createTable![1];
    expect(body).not.toMatch(/"otp"/);
    expect(body).not.toMatch(/"otp_code"|"code"|"pin"/);
    // The provider session id is the only provider artifact stored.
    expect(body).toMatch(/"provider_session_id" TEXT NOT NULL/);
  });

  it("has no member or user foreign key (linking is a later slice)", () => {
    const createTable = migrationSql.match(
      /CREATE TABLE "member_otp_challenges" \(([\s\S]*?)\);/,
    );
    const body = createTable![1];
    expect(body).not.toMatch(/"member_id"/);
    expect(body).not.toMatch(/"user_id"/);
    expect(migrationSql).not.toMatch(/REFERENCES "members"|REFERENCES "users"/);
    // The only foreign key is the tenant boundary: the organization.
    expect(migrationSql).toMatch(
      /FOREIGN KEY \("organization_id"\) REFERENCES "organizations"/,
    );
  });

  it("defines the full challenge status enum in both schema and migration", () => {
    for (const status of ["PENDING", "VERIFIED", "EXPIRED", "SUPERSEDED", "LOCKED"]) {
      expect(migrationSql).toContain(`'${status}'`);
      expect(schema).toContain(status);
    }
  });
});
