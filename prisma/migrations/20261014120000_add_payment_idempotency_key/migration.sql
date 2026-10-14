-- H4: idempotency token for payment-creating operations.
-- Nullable by design: existing payments keep NULL, and PostgreSQL
-- treats NULLs as distinct under a unique index, so keyless payments
-- never collide with each other or with keyed ones. The composite
-- unique index scopes every token to one organization.
ALTER TABLE "payments" ADD COLUMN "idempotency_key" TEXT;

CREATE UNIQUE INDEX "payments_organization_id_idempotency_key_key" ON "payments"("organization_id", "idempotency_key");
