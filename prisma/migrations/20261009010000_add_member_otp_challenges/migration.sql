-- Member OTP foundation (02-USER-FLOWS §9). Hand-written in the style of
-- 20261008230000_add_payments_and_audit_log.
--
-- The OTP itself is NEVER stored: the provider (2Factor AUTOGEN) generates
-- and verifies it. This table stores only the provider session identifier
-- plus lifecycle state (status/attempts/expiry), which doubles as the
-- database-backed rate-limit record (ADR 019) and OTP audit trail.
-- No member_id / user_id columns: at request time the phone number is
-- discovery only and no authenticated user exists yet.

-- CreateEnum
CREATE TYPE "OtpChallengeStatus" AS ENUM ('PENDING', 'VERIFIED', 'EXPIRED', 'SUPERSEDED', 'LOCKED');

-- CreateTable
CREATE TABLE "member_otp_challenges" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "provider_session_id" TEXT NOT NULL,
    "status" "OtpChallengeStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "member_otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "member_otp_challenges_organization_id_idx" ON "member_otp_challenges"("organization_id");

-- CreateIndex
CREATE INDEX "member_otp_challenges_organization_id_phone_number_created_at_idx" ON "member_otp_challenges"("organization_id", "phone_number", "created_at");

-- AddForeignKey
ALTER TABLE "member_otp_challenges" ADD CONSTRAINT "member_otp_challenges_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
