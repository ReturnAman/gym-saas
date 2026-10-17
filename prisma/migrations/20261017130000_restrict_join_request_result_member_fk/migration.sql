-- Slice 2 (join-request decisions): the resulting-member link on a
-- decided join request is provenance — deleting a Member that a
-- decided request produced must FAIL, not silently null the link.
-- The original FK used ON DELETE SET NULL, which would also have
-- tried to null the required organization_id half of the composite
-- key. Change the delete action to RESTRICT (the same posture as
-- audit_logs' actor FK). No data changes: resulting_member_id is
-- written by nothing before this migration ships with the decision
-- service, and the constraint is only exercised on member deletion,
-- for which no application flow exists.
ALTER TABLE "member_join_requests" DROP CONSTRAINT "member_join_requests_organization_id_resulting_member_id_fkey";

ALTER TABLE "member_join_requests" ADD CONSTRAINT "member_join_requests_organization_id_resulting_member_id_fkey" FOREIGN KEY ("organization_id", "resulting_member_id") REFERENCES "members"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
