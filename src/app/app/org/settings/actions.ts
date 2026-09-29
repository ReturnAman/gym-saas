"use server";

import { revalidatePath } from "next/cache";

import { requireCurrentUser } from "@/lib/server/auth";
import {
  OrganizationProfileAuthorizationError,
  OrganizationProfileValidationError,
  updateOrganizationProfile,
  type OrganizationProfileField,
} from "@/lib/server/organizations";

export interface ProfileFormState {
  ok: boolean;
  message: string | null;
  errors: Partial<Record<OrganizationProfileField | "form", string>>;
}

const INITIAL_STATE: ProfileFormState = { ok: false, message: null, errors: {} };

/**
 * Gym profile save handler.
 *
 * Authentication is enforced by requireCurrentUser (redirects to sign-in);
 * OWNER authorization, tenant isolation, and input validation are enforced
 * inside updateOrganizationProfile, server-side. The form never decides
 * what may be saved — it only renders the returned state.
 */
export async function updateOrganizationProfileAction(
  _prevState: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const user = await requireCurrentUser();

  try {
    await updateOrganizationProfile(user.id, {
      name: String(formData.get("name") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      email: String(formData.get("email") ?? ""),
      address: String(formData.get("address") ?? ""),
    });
  } catch (error) {
    if (error instanceof OrganizationProfileValidationError) {
      return { ok: false, message: null, errors: error.errors };
    }
    if (error instanceof OrganizationProfileAuthorizationError) {
      return { ok: false, message: error.message, errors: {} };
    }
    // Unknown failures (e.g. database errors) get a generic message —
    // never leak internals to the user (AGENTS.md §18).
    return {
      ok: false,
      message: "Could not save the gym profile. Please try again.",
      errors: {},
    };
  }

  revalidatePath("/app/org/settings");
  return { ok: true, message: "Gym profile saved.", errors: {} };
}

export { INITIAL_STATE as INITIAL_PROFILE_FORM_STATE };
