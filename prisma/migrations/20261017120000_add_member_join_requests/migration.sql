-- CreateEnum
CREATE TYPE "MemberJoinRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "member_join_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "requested_plan" "MembershipPlan" NOT NULL,
    "proposed_fee" DECIMAL(12,2) NOT NULL,
    "proposed_start_date" DATE NOT NULL,
    "status" "MemberJoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decided_by_user_id" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "resulting_member_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "member_join_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "member_join_requests_organization_id_status_created_at_idx" ON "member_join_requests"("organization_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "member_join_requests_organization_id_id_key" ON "member_join_requests"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "member_join_requests" ADD CONSTRAINT "member_join_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_join_requests" ADD CONSTRAINT "member_join_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_join_requests" ADD CONSTRAINT "member_join_requests_organization_id_resulting_member_id_fkey" FOREIGN KEY ("organization_id", "resulting_member_id") REFERENCES "members"("organization_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Partial unique index (declared here only — Prisma cannot express
-- partial indexes): at most one PENDING join request may exist per
-- phone number per organization, so a duplicate pending request is
-- impossible even under concurrent submissions. The organization is
-- part of the key, so the constraint operates strictly within one
-- gym: a pending request in one gym can neither block nor be revealed
-- to another. Decided requests (APPROVED/REJECTED) leave the index,
-- so the person may request again after a decision.
CREATE UNIQUE INDEX "member_join_requests_one_pending_per_phone"
ON "member_join_requests" ("organization_id", "phone_number")
WHERE "status" = 'PENDING';
