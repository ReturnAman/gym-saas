-- CreateEnum
CREATE TYPE "SaasOfferStatus" AS ENUM ('REQUESTED', 'APPROVED', 'DECLINED', 'ACCEPTED');

-- CreateTable
CREATE TABLE "organization_subscriptions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "trial_started_at" TIMESTAMPTZ(6),
    "trial_ends_at" TIMESTAMPTZ(6),
    "paid_period_start_at" TIMESTAMPTZ(6),
    "paid_period_end_at" TIMESTAMPTZ(6),
    "paid_through_at" TIMESTAMPTZ(6),
    "suspended_at" TIMESTAMPTZ(6),
    "suspended_by_clerk_user_id" TEXT,
    "suspension_reason" TEXT,
    "offer_prompt_dismissed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organization_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saas_trial_claims" (
    "id" TEXT NOT NULL,
    "clerk_user_id" TEXT NOT NULL,
    "canonical_phone" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "claimed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saas_trial_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saas_subscription_payments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "reference" TEXT,
    "period_start_at" TIMESTAMPTZ(6) NOT NULL,
    "period_end_at" TIMESTAMPTZ(6) NOT NULL,
    "recorded_by_clerk_user_id" TEXT NOT NULL,
    "notes" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saas_subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saas_offer_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "status" "SaasOfferStatus" NOT NULL DEFAULT 'REQUESTED',
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "discount_percent" INTEGER,
    "offer_expires_at" TIMESTAMPTZ(6),
    "applicable_period_start_at" TIMESTAMPTZ(6),
    "applicable_period_end_at" TIMESTAMPTZ(6),
    "agreed_amount" DECIMAL(12,2),
    "decided_by_clerk_user_id" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "accepted_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "saas_offer_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_subscriptions_organization_id_key" ON "organization_subscriptions"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "saas_trial_claims_clerk_user_id_key" ON "saas_trial_claims"("clerk_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "saas_trial_claims_canonical_phone_key" ON "saas_trial_claims"("canonical_phone");

-- CreateIndex
CREATE INDEX "saas_subscription_payments_organization_id_idx" ON "saas_subscription_payments"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "saas_subscription_payments_organization_id_idempotency_key_key" ON "saas_subscription_payments"("organization_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "saas_offer_requests_organization_id_status_idx" ON "saas_offer_requests"("organization_id", "status");

-- AddForeignKey
ALTER TABLE "organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saas_trial_claims" ADD CONSTRAINT "saas_trial_claims_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saas_subscription_payments" ADD CONSTRAINT "saas_subscription_payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saas_subscription_payments" ADD CONSTRAINT "saas_subscription_payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "organization_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saas_offer_requests" ADD CONSTRAINT "saas_offer_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "member_otp_challenges_organization_id_phone_number_created_at_i" RENAME TO "member_otp_challenges_organization_id_phone_number_created__idx";

-- Partial unique index (declared only here; Prisma cannot express it):
-- at most one PENDING offer request per gym, so repeated owner clicks
-- can never create duplicate pending requests even under concurrency.
CREATE UNIQUE INDEX "saas_offer_requests_one_pending_per_org" ON "saas_offer_requests"("organization_id") WHERE "status" = 'REQUESTED';
