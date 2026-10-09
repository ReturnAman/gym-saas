-- Attendance V1 — Slice 1 (staff manual check-in/check-out + history).
-- Hand-written in the style of 20261008230000_add_payments_and_audit_log.
--
-- An attendance_sessions row is one gym visit. Open vs closed is derived
-- from check_out_at (NULL = still in the gym); there is no status column.
--
-- PARTIAL UNIQUE INDEX: attendance_sessions_one_open_per_member enforces
-- at most one OPEN session per (organization, member). Prisma cannot
-- express partial indexes, so this index exists only in this migration —
-- it must be preserved if migrations are ever generated with
-- `prisma migrate dev`. Safe on existing data: the table is new and
-- empty.

-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('MANUAL', 'QR');

-- CreateTable
CREATE TABLE "attendance_sessions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "checked_in_by" TEXT NOT NULL,
    "source" "AttendanceSource" NOT NULL DEFAULT 'MANUAL',
    "check_in_at" TIMESTAMPTZ(6) NOT NULL,
    "check_out_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_sessions_organization_id_id_key" ON "attendance_sessions"("organization_id", "id");

-- CreateIndex
CREATE INDEX "attendance_sessions_organization_id_idx" ON "attendance_sessions"("organization_id");

-- CreateIndex
CREATE INDEX "attendance_sessions_organization_id_member_id_idx" ON "attendance_sessions"("organization_id", "member_id");

-- CreateIndex
CREATE INDEX "attendance_sessions_organization_id_check_in_at_idx" ON "attendance_sessions"("organization_id", "check_in_at");

-- Partial unique index (not expressible in the Prisma schema): at most
-- one open (not yet checked out) session per member per organization.
CREATE UNIQUE INDEX "attendance_sessions_one_open_per_member" ON "attendance_sessions"("organization_id", "member_id") WHERE "check_out_at" IS NULL;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (composite): attendance_sessions.organization_id +
-- attendance_sessions.member_id must match the member's
-- (organization_id, id). A session can never reference a member of a
-- different organization.
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_organization_id_member_id_fkey" FOREIGN KEY ("organization_id", "member_id") REFERENCES "members"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: the user who recorded the check-in. RESTRICT: a user
-- who has recorded check-ins cannot be deleted out from under the
-- attendance record.
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_checked_in_by_fkey" FOREIGN KEY ("checked_in_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
