-- CreateEnum
CREATE TYPE "MembershipPlan" AS ENUM ('MONTHLY', 'THREE_MONTHS', 'SIX_MONTHS', 'TWELVE_MONTHS');

-- CreateTable
CREATE TABLE "members" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- No paid_amount column: payment is a separate domain (04-DATABASE-DESIGN
-- §16, §17). Paid/outstanding are derived, not persisted.
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "plan" "MembershipPlan" NOT NULL,
    "start_date" DATE NOT NULL,
    "expiry_date" DATE NOT NULL,
    "fee" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "members_organization_id_idx" ON "members"("organization_id");

-- CreateIndex
CREATE INDEX "members_organization_id_phone_number_idx" ON "members"("organization_id", "phone_number");

-- CreateIndex
CREATE INDEX "memberships_organization_id_idx" ON "memberships"("organization_id");

-- CreateIndex
CREATE INDEX "memberships_member_id_idx" ON "memberships"("member_id");

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Composite uniqueness backing the composite membership foreign key below.
-- Naming matches Prisma's @@unique([organizationId, id]) convention so the
-- schema and this migration stay coherent.
ALTER TABLE "members" ADD CONSTRAINT "members_organization_id_id_key" UNIQUE ("organization_id", "id");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (composite): membership.organization_id + membership.member_id
-- must match the member's (organization_id, id). A membership can never
-- reference a member of a different organization — the database rejects it,
-- not just application code.
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_member_id_fkey" FOREIGN KEY ("organization_id", "member_id") REFERENCES "members"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
