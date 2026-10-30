import { redirect } from "next/navigation";

import { requireEntitledOrganizationContext } from "@/lib/server/subscriptions";
import { getMemberPermissions } from "@/lib/server/members";

import { MemberForm } from "../member-form";

/**
 * Add Member page (protected).
 *
 * Only roles that may create members (OWNER/ADMIN/STAFF) reach the form;
 * the server action enforces this regardless of the UI.
 */
export default async function NewMemberPage() {
  const { membership } = await requireEntitledOrganizationContext();
  if (!getMemberPermissions(membership.role).canCreate) {
    redirect("/app/org/members");
  }

  return (
    <main>
      <h1>Add member</h1>
      <p>Add a single member manually — for new members and individual records.</p>
      <MemberForm />
    </main>
  );
}
