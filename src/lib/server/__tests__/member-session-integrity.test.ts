import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

const MIGRATION_SQL = read(
  "prisma/migrations/20261009110000_add_member_sessions_and_phone_identity/migration.sql",
);
const SCHEMA = read("prisma/schema.prisma");

/**
 * Member identity + session schema integrity (ADR 021), plus the
 * Clerk-isolation guard: the member path must never touch Clerk, and the
 * Clerk path must remain exactly as it was.
 */
describe("member identity schema", () => {
  it("makes clerk_user_id nullable and adds a unique phone identity", () => {
    expect(MIGRATION_SQL).toMatch(
      /ALTER TABLE "users" ALTER COLUMN "clerk_user_id" DROP NOT NULL/,
    );
    expect(MIGRATION_SQL).toMatch(
      /CREATE UNIQUE INDEX "users_phone_number_key" ON "users"\("phone_number"\)/,
    );
    expect(SCHEMA).toMatch(/clerkUserId String\? @unique/);
    expect(SCHEMA).toMatch(/phoneNumber String\? @unique/);
  });

  it("adds consumed_at to member_otp_challenges", () => {
    expect(MIGRATION_SQL).toMatch(
      /ALTER TABLE "member_otp_challenges" ADD COLUMN "consumed_at"/,
    );
    expect(SCHEMA).toMatch(/consumedAt\s+DateTime\?/);
  });
});

describe("member_sessions storage", () => {
  it("creates the table with a unique token hash and both FKs", () => {
    expect(MIGRATION_SQL).toMatch(/CREATE TABLE "member_sessions"/);
    expect(MIGRATION_SQL).toMatch(
      /CREATE UNIQUE INDEX "member_sessions_token_hash_key" ON "member_sessions"\("token_hash"\)/,
    );
    expect(MIGRATION_SQL).toMatch(
      /FOREIGN KEY \("user_id"\) REFERENCES "users"/,
    );
    expect(MIGRATION_SQL).toMatch(
      /FOREIGN KEY \("organization_id"\) REFERENCES "organizations"/,
    );
    expect(SCHEMA).toMatch(/model MemberSession/);
    expect(SCHEMA).toMatch(/tokenHash\s+String\s+@unique/);
  });

  it("has no column that could store a raw session token", () => {
    const createTable = MIGRATION_SQL.match(
      /CREATE TABLE "member_sessions" \(([\s\S]*?)\);/,
    );
    expect(createTable).not.toBeNull();
    const body = createTable![1];
    expect(body).toMatch(/"token_hash" TEXT NOT NULL/);
    expect(body).not.toMatch(/"token"\s/);
    const model = SCHEMA.match(/model MemberSession \{([\s\S]*?)\n\}/);
    expect(model).not.toBeNull();
    expect(model![1]).not.toMatch(/^\s+token\s/m);
  });

  it("adds the partial unique index for one linked Member per gym+user", () => {
    expect(MIGRATION_SQL).toMatch(
      /CREATE UNIQUE INDEX "members_organization_id_user_id_key" ON "members"\("organization_id", "user_id"\) WHERE "user_id" IS NOT NULL/,
    );
  });
});

describe("Clerk isolation", () => {
  const memberModules = [
    "src/lib/server/member-auth.ts",
    "src/lib/server/member-linking.ts",
    "src/lib/server/member-session.ts",
    "src/lib/server/otp-service.ts",
    "src/app/api/member-auth/link/route.ts",
    "src/app/api/member-auth/logout/route.ts",
    "src/app/member/page.tsx",
  ];

  it("member-path code never references Clerk or the Clerk user resolvers", () => {
    for (const file of memberModules) {
      const source = read(file);
      expect(source, file).not.toMatch(/@clerk/);
      expect(source, file).not.toContain("getCurrentUser");
      expect(source, file).not.toContain("requireCurrentUser");
      expect(source, file).not.toContain("requireOrganizationContext");
    }
  });

  it("the Clerk path (getCurrentUser upsert) is unchanged", () => {
    const auth = read("src/lib/server/auth.ts");
    expect(auth).toContain("db.user.upsert");
    expect(auth).toMatch(/where: \{ clerkUserId \}/);
  });
});
