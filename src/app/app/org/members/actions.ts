"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireCurrentUser } from "@/lib/server/auth";
import {
  MemberAuthorizationError,
  MemberDuplicateError,
  MemberNotFoundError,
  createMemberWithMembership,
  updateMember,
  type DuplicateMember,
} from "@/lib/server/members";
import {
  MemberValidationError,
  type MemberField,
} from "@/lib/members";

export interface MemberFormState {
  ok: boolean;
  message: string | null;
  errors: Partial<Record<MemberField | "form", string>>;
  /** Present when creation was held back for a duplicate-phone decision. */
  duplicates: DuplicateMember[];
}

export const INITIAL_MEMBER_FORM_STATE: MemberFormState = {
  ok: false,
  message: null,
  errors: {},
  duplicates: [],
};

function toFormInput(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    phoneNumber: String(formData.get("phoneNumber") ?? ""),
    fee: String(formData.get("fee") ?? ""),
    plan: String(formData.get("plan") ?? ""),
    startDate: String(formData.get("startDate") ?? ""),
  };
}

/**
 * Add-member submit handler.
 *
 * Authentication is enforced by requireCurrentUser (redirects to sign-in);
 * OWNER/ADMIN/STAFF authorization, tenant isolation, duplicate-phone
 * surfacing, and input validation are enforced inside
 * createMemberWithMembership, server-side. The form never decides what may
 * be saved — it only renders the returned state.
 *
 * Double submission: the submit button is disabled while the action is in
 * flight, and a successful creation redirects to the new member's page, so
 * a refresh or back-button cannot replay the creation.
 */
export async function createMemberAction(
  _prevState: MemberFormState,
  formData: FormData,
): Promise<MemberFormState> {
  const user = await requireCurrentUser();
  const allowDuplicate = formData.get("allowDuplicate") === "true";

  let memberId: string;
  try {
    ({ memberId } = await createMemberWithMembership(
      user.id,
      toFormInput(formData),
      { allowDuplicate },
    ));
  } catch (error) {
    if (error instanceof MemberValidationError) {
      return { ok: false, message: null, errors: error.errors, duplicates: [] };
    }
    if (error instanceof MemberDuplicateError) {
      return {
        ok: false,
        message: null,
        errors: {},
        duplicates: error.duplicates,
      };
    }
    if (error instanceof MemberAuthorizationError) {
      return {
        ok: false,
        message: error.message,
        errors: {},
        duplicates: [],
      };
    }
    // Unknown failures (e.g. database errors) get a generic message —
    // never leak internals to the user.
    return {
      ok: false,
      message: "Could not add the member. Please try again.",
      errors: {},
      duplicates: [],
    };
  }

  revalidatePath("/app/org/members");
  redirect(`/app/org/members/${memberId}`);
}

/**
 * Edit-member submit handler (identity/contact fields only). The member ID
 * comes from a hidden field but is never trusted: updateMember re-verifies
 * it against the caller's organization server-side.
 */
export async function updateMemberAction(
  _prevState: MemberFormState,
  formData: FormData,
): Promise<MemberFormState> {
  const user = await requireCurrentUser();
  const memberId = String(formData.get("memberId") ?? "");
  const allowDuplicate = formData.get("allowDuplicate") === "true";

  try {
    await updateMember(
      user.id,
      memberId,
      {
        name: String(formData.get("name") ?? ""),
        phoneNumber: String(formData.get("phoneNumber") ?? ""),
      },
      { allowDuplicate },
    );
  } catch (error) {
    if (error instanceof MemberValidationError) {
      return { ok: false, message: null, errors: error.errors, duplicates: [] };
    }
    if (error instanceof MemberDuplicateError) {
      return {
        ok: false,
        message: null,
        errors: {},
        duplicates: error.duplicates,
      };
    }
    if (
      error instanceof MemberAuthorizationError ||
      error instanceof MemberNotFoundError
    ) {
      return {
        ok: false,
        message: error.message,
        errors: {},
        duplicates: [],
      };
    }
    return {
      ok: false,
      message: "Could not save the member. Please try again.",
      errors: {},
      duplicates: [],
    };
  }

  revalidatePath("/app/org/members");
  revalidatePath(`/app/org/members/${memberId}`);
  redirect(`/app/org/members/${memberId}`);
}
