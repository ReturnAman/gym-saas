-- Payments V1 (04-DATABASE-DESIGN §14, §16, §17) + minimal audit log
-- (ADR 017). Hand-written in the style of
-- 20261001020000_add_members_and_memberships.
--
-- No paid_amount / balance column is created anywhere: paid and
-- outstanding are derived from the payment records
-- (Outstanding = membership fee − SUM(confirmed payments)).

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('UPI', 'CASH', 'CARD', 'OTHER');

-- Composite uniqueness on memberships backing the composite payment
-- foreign key below (same pattern members already uses for memberships).
-- Naming matches Prisma's @@unique([organizationId, id]) convention.
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_id_key" UNIQUE ("organization_id", "id");

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "confirmed_at" TIMESTAMPTZ(6) NOT NULL,
    "confirmed_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- Append-only audit log: no updated_at.
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payments_organization_id_idx" ON "payments"("organization_id");

-- CreateIndex
CREATE INDEX "payments_member_id_idx" ON "payments"("member_id");

-- CreateIndex
CREATE INDEX "payments_membership_id_idx" ON "payments"("membership_id");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_idx" ON "audit_logs"("organization_id");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_target_type_target_id_idx" ON "audit_logs"("organization_id", "target_type", "target_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (composite): payment.organization_id + payment.member_id
-- must match the member's (organization_id, id). A payment can never
-- reference a member of a different organization.
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_member_id_fkey" FOREIGN KEY ("organization_id", "member_id") REFERENCES "members"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (composite): payment.organization_id + payment.membership_id
-- must match the membership's (organization_id, id). A payment can never
-- reference a membership of a different organization.
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_membership_id_fkey" FOREIGN KEY ("organization_id", "membership_id") REFERENCES "memberships"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: the confirming staff user. RESTRICT: a user who has
-- confirmed payments cannot be deleted out from under the financial record.
ALTER TABLE "payments" ADD CONSTRAINT "payments_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
