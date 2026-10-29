import { notFound, redirect } from "next/navigation";

import { requireEntitledOrganizationContext } from "@/lib/server/subscriptions";
import { getMemberDetail, getMemberPermissions } from "@/lib/server/members";
import { formatInr } from "@/lib/members";

import { RecordPaymentForm } from "./payment-form";

/**
 * Record Payment page (protected).
 *
 * Records a payment the gym has actually received against the member's
 * current membership. Authorization (OWNER/ADMIN/STAFF), tenant isolation,
 * and validation are enforced again inside recordPayment — this page only
 * gates the UI and renders context.
 */
export default async function RecordPaymentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user, membership } = await requireEntitledOrganizationContext();
  if (!getMemberPermissions(membership.role).canRecordPayment) {
    redirect("/app/org/members");
  }

  const { id } = await params;
  const detail = await getMemberDetail(user.id, id);
  if (!detail || !detail.membership) {
    notFound();
  }

  return (
    <main>
      <h1>Record payment</h1>
      <p>
        Record a payment received from {detail.name} for their{" "}
        {detail.membership.planLabel} membership. Total fee{" "}
        {formatInr(detail.membership.feePaise)} · Paid{" "}
        {formatInr(detail.membership.paidPaise)} · Outstanding{" "}
        {formatInr(detail.membership.outstandingPaise)}.
      </p>
      <p>
        Recording a payment does not renew or extend the membership — it only
        records money the gym has received.
      </p>
      <RecordPaymentForm memberId={detail.id} />
    </main>
  );
}
