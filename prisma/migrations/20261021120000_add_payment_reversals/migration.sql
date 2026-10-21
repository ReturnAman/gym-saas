-- CreateEnum
CREATE TYPE "PaymentReversalReason" AS ENUM ('DUPLICATE_ENTRY', 'WRONG_MEMBER', 'WRONG_AMOUNT', 'PAYMENT_FAILED', 'REFUNDED_TO_MEMBER', 'OTHER');

-- CreateTable
CREATE TABLE "payment_reversals" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" "PaymentReversalReason" NOT NULL,
    "explanation" TEXT,
    "reversed_by" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_reversals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_reversals_organization_id_idx" ON "payment_reversals"("organization_id");

-- CreateIndex
CREATE INDEX "payment_reversals_payment_id_idx" ON "payment_reversals"("payment_id");

-- CreateIndex
CREATE INDEX "payment_reversals_membership_id_idx" ON "payment_reversals"("membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_reversals_organization_id_idempotency_key_key" ON "payment_reversals"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payments_organization_id_id_key" ON "payments"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_organization_id_payment_id_fkey" FOREIGN KEY ("organization_id", "payment_id") REFERENCES "payments"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_organization_id_member_id_fkey" FOREIGN KEY ("organization_id", "member_id") REFERENCES "members"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_organization_id_membership_id_fkey" FOREIGN KEY ("organization_id", "membership_id") REFERENCES "memberships"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_reversed_by_fkey" FOREIGN KEY ("reversed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

