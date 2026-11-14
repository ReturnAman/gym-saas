import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const ORIGINAL_MIGRATION_SQL_PATH = path.join(
  repoRoot,
  "prisma/migrations/20261009010000_add_member_otp_challenges/migration.sql",
);
const OTP_HASH_MIGRATION_SQL_PATH = path.join(
  repoRoot,
  "prisma/migrations/20261105120000_replace_otp_provider_session_with_hash/migration.sql",
);
const SCHEMA_PATH = path.join(repoRoot, "prisma/schema.prisma");

/**
 * Member OTP challenge storage integrity.
 *
 * The application generates the OTP and verifies it locally — the
 * database must never be able to hold a usable code. These coherence
 * checks pin the migration CHAIN and the current schema: the original
 * migration (preserved unchanged, as history) created the table under
 * the provider-managed model; the APITxT migration retires that model
 * (digest column in, pending challenges superseded, provider session
 * column out); and the current schema stores only a keyed digest, with
 * no OTP column and no member/user foreign keys (at request time the
 * phone is discovery only and no authenticated user exists).
 */
describe("member OTP challenge schema", () => {
  const originalMigrationSql = readFileSync(ORIGINAL_MIGRATION_SQL_PATH, "utf8");
  const otpHashMigrationSql = readFileSync(OTP_HASH_MIGRATION_SQL_PATH, "utf8");
  const schema = readFileSync(SCHEMA_PATH, "utf8");
  const schemaModel = schema.match(
    /model MemberOtpChallenge \{([\s\S]*?)\n\}/,
  )?.[1];

  it("the original migration creates the member_otp_challenges table", () => {
    expect(originalMigrationSql).toMatch(/CREATE TABLE "member_otp_challenges"/);
    expect(schema).toMatch(/model MemberOtpChallenge/);
    expect(schemaModel).toBeDefined();
  });

  it("creates the tenant + rate-limit composite index", () => {
    expect(originalMigrationSql).toMatch(
      /CREATE INDEX "member_otp_challenges_organization_id_phone_number_created_at_idx" ON "member_otp_challenges"\("organization_id", "phone_number", "created_at"\)/,
    );
    expect(schema).toMatch(
      /@@index\(\[organizationId, phoneNumber, createdAt\]\)/,
    );
  });

  it("the APITxT migration adds the digest, retires pending challenges, and drops the provider session", () => {
    expect(otpHashMigrationSql).toMatch(
      /ALTER TABLE "member_otp_challenges" ADD COLUMN "otp_hash" TEXT;/,
    );
    expect(otpHashMigrationSql).toMatch(
      /UPDATE "member_otp_challenges" SET "status" = 'SUPERSEDED' WHERE "status" = 'PENDING';/,
    );
    expect(otpHashMigrationSql).toMatch(
      /ALTER TABLE "member_otp_challenges" DROP COLUMN "provider_session_id";/,
    );
  });

  it("the current schema stores only the digest — no provider session, no plaintext code", () => {
    expect(schemaModel).toMatch(/otpHash\s+String\?\s+@map\("otp_hash"\)/);
    expect(schemaModel).not.toMatch(/providerSessionId|provider_session_id/);
    // No field that could hold the raw code itself.
    expect(schemaModel).not.toMatch(/^\s+(otp|code|pin)\s+/m);
    // The historical migration did carry the provider session column;
    // that file is preserved unchanged as history.
    expect(originalMigrationSql).toMatch(/"provider_session_id" TEXT NOT NULL/);
  });

  it("has no member or user foreign key (linking is a later slice)", () => {
    const createTable = originalMigrationSql.match(
      /CREATE TABLE "member_otp_challenges" \(([\s\S]*?)\);/,
    );
    const body = createTable![1];
    expect(body).not.toMatch(/"member_id"/);
    expect(body).not.toMatch(/"user_id"/);
    expect(originalMigrationSql).not.toMatch(/REFERENCES "members"|REFERENCES "users"/);
    // The only foreign key is the tenant boundary: the organization.
    expect(originalMigrationSql).toMatch(
      /FOREIGN KEY \("organization_id"\) REFERENCES "organizations"/,
    );
    expect(schemaModel).toMatch(/organization\s+Organization\s+@relation/);
    expect(schemaModel).not.toMatch(/memberId|userId/);
  });

  it("defines the full challenge status enum in both schema and migration", () => {
    for (const status of ["PENDING", "VERIFIED", "EXPIRED", "SUPERSEDED", "LOCKED"]) {
      expect(originalMigrationSql).toContain(`'${status}'`);
      expect(schema).toContain(status);
    }
  });
});
