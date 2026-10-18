-- Seed fixture for the migration upgrade-path test (Phase B).
--
-- Applied by scripts/run-upgrade-test.mjs AFTER the pinned baseline
-- migrations (a046fcb, 10 migrations) and BEFORE the upgrade to HEAD, so
-- every table and column referenced here must exist at the BASELINE schema.
-- Baseline-era tables only: member_join_requests does not exist at the
-- baseline and must never be referenced here.
--
-- Synthetic data only — fixed UUIDs and fixed timestamps so the runner can
-- assert byte-identical survival after the upgrade. The runner carries its
-- own independently defined EXPECTED copy of these values on purpose: if
-- this file and the runner ever disagree, the rehearsal fails loudly.
--
-- One tenant graph: an organization, its OWNER user, one member with one
-- membership, one confirmed payment against that membership, and one
-- PENDING payment claim against the same membership.

INSERT INTO organizations (id, name, phone, email, address, created_at, updated_at)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'Upgrade Path Test Gym',
  NULL,
  NULL,
  NULL,
  '2026-09-01T09:00:00Z',
  '2026-09-01T09:00:00Z'
);

INSERT INTO users (id, clerk_user_id, phone_number, created_at, updated_at)
VALUES (
  '22222222-2222-4222-8222-222222222222',
  'user_upgrade_path_test',
  NULL,
  '2026-09-01T09:00:00Z',
  '2026-09-01T09:00:00Z'
);

INSERT INTO organization_memberships (id, user_id, organization_id, role, created_at, updated_at)
VALUES (
  '33333333-3333-4333-8333-333333333333',
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'OWNER',
  '2026-09-01T09:00:00Z',
  '2026-09-01T09:00:00Z'
);

INSERT INTO members (id, organization_id, user_id, name, phone_number, created_at, updated_at)
VALUES (
  '44444444-4444-4444-8444-444444444444',
  '11111111-1111-4111-8111-111111111111',
  NULL,
  'Upgrade Test Member',
  '9000000001',
  '2026-09-01T09:00:00Z',
  '2026-09-01T09:00:00Z'
);

INSERT INTO memberships (id, organization_id, member_id, plan, start_date, expiry_date, fee, created_at, updated_at)
VALUES (
  '55555555-5555-4555-8555-555555555555',
  '11111111-1111-4111-8111-111111111111',
  '44444444-4444-4444-8444-444444444444',
  'MONTHLY',
  '2026-09-01',
  '2026-10-01',
  1500.00,
  '2026-09-01T09:00:00Z',
  '2026-09-01T09:00:00Z'
);

INSERT INTO payments (
  id, organization_id, member_id, membership_id, amount, payment_method,
  reference, confirmed_at, confirmed_by, payment_claim_id, idempotency_key,
  created_at, updated_at
)
VALUES (
  '66666666-6666-4666-8666-666666666666',
  '11111111-1111-4111-8111-111111111111',
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
  1500.00,
  'UPI',
  NULL,
  '2026-09-01T10:00:00Z',
  '22222222-2222-4222-8222-222222222222',
  NULL,
  NULL,
  '2026-09-01T09:00:00Z',
  '2026-09-01T09:00:00Z'
);

INSERT INTO payment_claims (
  id, organization_id, member_id, membership_id, claimed_amount,
  payment_method, reference, status, verified_at, verified_by,
  created_at, updated_at
)
VALUES (
  '77777777-7777-4777-8777-777777777777',
  '11111111-1111-4111-8111-111111111111',
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
  500.00,
  'UPI',
  'UTR-UPGRADE-TEST-001',
  'PENDING',
  NULL,
  NULL,
  '2026-09-01T09:00:00Z',
  '2026-09-01T09:00:00Z'
);
