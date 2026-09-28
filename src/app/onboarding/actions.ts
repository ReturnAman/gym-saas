"use server";

import { redirect } from "next/navigation";

import { requireCurrentUser } from "@/lib/server/auth";
import { createOrganization } from "@/lib/server/organizations";

/**
 * Owner onboarding submission: the authenticated user creates their first
 * gym. Unauthenticated callers are redirected to sign-in by
 * requireCurrentUser before anything else happens; on success the owner
 * lands in their organization's protected area.
 */
export async function createOrganizationAction(
  formData: FormData,
): Promise<void> {
  const user = await requireCurrentUser();
  await createOrganization(user.id, {
    name: String(formData.get("name") ?? ""),
  });
  redirect("/app/org");
}
