import { notFound, redirect } from "next/navigation";

import { requireEntitledOrganizationContext } from "@/lib/server/subscriptions";
import { getMemberDetail, getMemberPermissions } from "@/lib/server/members";

import { EditMemberForm } from "./edit-form";

/**
 * Edit Member page (protected) — identity/contact fields only.
 */
export default async function EditMemberPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user, membership } = await requireEntitledOrganizationContext();
  if (!getMemberPermissions(membership.role).canEdit) {
    redirect("/app/org/members");
  }

  const { id } = await params;
  const detail = await getMemberDetail(user.id, id);
  if (!detail) {
    notFound();
  }

  return (
    <main>
      <h1>Edit member</h1>
      <p>
        Update the member&apos;s name or phone number. Membership details
        (plan, dates, fee) are not editable here.
      </p>
      <EditMemberForm
        initial={{
          id: detail.id,
          name: detail.name,
          phoneNumber: detail.phoneNumber,
        }}
      />
    </main>
  );
}
