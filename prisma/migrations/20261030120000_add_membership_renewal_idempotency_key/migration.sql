-- Membership renewal replay protection (expand-only).
--
-- Adds the nullable renewal idempotency key to memberships plus its
-- organization-scoped unique index. Existing rows keep NULL, which
-- PostgreSQL treats as distinct under the unique index, so keyless
-- memberships (the initial membership and all pre-renewal rows) never
-- collide. No existing column, constraint, or row is changed, and the
-- migration is safe to apply while the previous release is running.

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN "renewal_idempotency_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "memberships_organization_id_renewal_idempotency_key_key" ON "memberships"("organization_id", "renewal_idempotency_key");
