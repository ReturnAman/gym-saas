-- CreateEnum
CREATE TYPE "PaymentClaimStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "payment_claim_id" TEXT;

-- CreateTable
CREATE TABLE "payment_claims" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "claimed_amount" DECIMAL(12,2) NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "status" "PaymentClaimStatus" NOT NULL DEFAULT 'PENDING',
    "verified_at" TIMESTAMPTZ(6),
    "verified_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_claims_organization_id_status_idx" ON "payment_claims"("organization_id", "status");

-- CreateIndex
CREATE INDEX "payment_claims_member_id_idx" ON "payment_claims"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_claims_organization_id_id_key" ON "payment_claims"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_organization_id_payment_claim_id_key" ON "payments"("organization_id", "payment_claim_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_payment_claim_id_fkey" FOREIGN KEY ("organization_id", "payment_claim_id") REFERENCES "payment_claims"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_organization_id_member_id_fkey" FOREIGN KEY ("organization_id", "member_id") REFERENCES "members"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_organization_id_membership_id_fkey" FOREIGN KEY ("organization_id", "membership_id") REFERENCES "memberships"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Partial unique index (declared here only — Prisma cannot express
-- partial indexes): at most one PENDING claim per membership may carry
-- the same claimed amount, payment method and reference, so an exact
-- duplicate pending claim is impossible even under concurrent
-- submissions. COALESCE makes a missing reference collide with a
-- missing reference (plain NULLs would compare distinct and slip
-- past). Decided claims (CONFIRMED/REJECTED) leave the index, so a
-- member can claim the same amount again after a decision.
CREATE UNIQUE INDEX "payment_claims_no_duplicate_pending"
ON "payment_claims" ("membership_id", "claimed_amount", "payment_method", COALESCE("reference", ''))
WHERE "status" = 'PENDING';
