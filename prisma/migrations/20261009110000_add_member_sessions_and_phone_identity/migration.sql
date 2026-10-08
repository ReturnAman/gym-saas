-- Member identity + sessions (ADR 021). Hand-written in the style of
-- 20261008230000_add_payments_and_audit_log.
--
-- 1. users: clerk_user_id becomes nullable and a nullable unique
--    phone_number identity is added. One User model serves both identity
--    kinds; PostgreSQL unique indexes admit multiple NULLs, so
--    single-identity users never collide, while a non-null phone is
--    globally unique (one verified phone = one User). Existing rows are
--    Clerk users with phone_number NULL — no backfill needed.
-- 2. member_otp_challenges: consumed_at marks a VERIFIED challenge as
--    consumed by member linking (set exactly once, atomically).
-- 3. member_sessions: gym-scoped member sessions storing only the
--    SHA-256 hash of the session token.
-- 4. A PARTIAL unique index enforces one linked Member per (gym, user).
--    Prisma cannot express partial indexes, so this index exists only
--    here — it must be preserved if migrations are ever generated with
--    `prisma migrate dev`. Safe on existing data: members.user_id is
--    NULL on every current row.

-- AlterTable: phone identity on users, Clerk identity becomes optional
ALTER TABLE "users" ALTER COLUMN "clerk_user_id" DROP NOT NULL;
ALTER TABLE "users" ADD COLUMN "phone_number" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_number_key" ON "users"("phone_number");

-- AlterTable: challenge consumption marker
ALTER TABLE "member_otp_challenges" ADD COLUMN "consumed_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "member_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "member_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "member_sessions_token_hash_key" ON "member_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "member_sessions_user_id_idx" ON "member_sessions"("user_id");

-- CreateIndex
CREATE INDEX "member_sessions_organization_id_idx" ON "member_sessions"("organization_id");

-- AddForeignKey
ALTER TABLE "member_sessions" ADD CONSTRAINT "member_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_sessions" ADD CONSTRAINT "member_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique index (not expressible in the Prisma schema): at most
-- one Member row per organization may be linked to a given user.
CREATE UNIQUE INDEX "members_organization_id_user_id_key" ON "members"("organization_id", "user_id") WHERE "user_id" IS NOT NULL;
