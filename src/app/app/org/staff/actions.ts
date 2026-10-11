"use server";

import { revalidatePath } from "next/cache";
import type { Role } from "@prisma/client";

import { requireCurrentUser } from "@/lib/server/auth";
import {
  ClerkDirectoryUnavailableError,
  STAFF_SIGN_IN_FIRST_MESSAGE,
  StaffAccountNotFoundError,
  StaffAuthorizationError,
  StaffConflictError,
  StaffNotFoundError,
  StaffValidationError,
  addOrganizationStaff,
  changeOrganizationStaffRole,
  findStaffCandidateByEmail,
  revokeOrganizationStaffAccess,
} from "@/lib/server/staff";

import type {
  StaffLookupState,
  StaffMutationState,
} from "./staff-action-state";

/**
 * Server actions for the staff management page.
 *
 * Authentication comes from requireCurrentUser (redirects to sign-in);
 * organization scope, Clerk account verification, the role matrix,
 * target checks, transaction safety, and audit events are all enforced
 * inside the staff service. These actions only translate form data into
 * service calls and service outcomes into safe UI state. No action
 * accepts an organization ID or a target user ID: adds identify the
 * account by email (re-resolved server-side at mutation time), and
 * role changes / revocations identify the membership row only.
 */

const STAFF_PATH = "/app/org/staff";

const ASSIGNABLE_ROLES: readonly Role[] = ["ADMIN", "STAFF", "TRAINER"];

function parseRole(value: FormDataEntryValue | null): Role | null {
  return ASSIGNABLE_ROLES.find((role) => role === value) ?? null;
}

/**
 * Map a service error to a message safe to show. The staff service's
 * own error messages are written for end users (no internals); unknown
 * errors collapse to a generic fallback.
 */
function toSafeMessage(error: unknown, fallback: string): string {
  if (error instanceof StaffAccountNotFoundError) {
    return STAFF_SIGN_IN_FIRST_MESSAGE;
  }
  if (error instanceof ClerkDirectoryUnavailableError) {
    return "Account lookup is unavailable right now. Please try again.";
  }
  if (
    error instanceof StaffAuthorizationError ||
    error instanceof StaffConflictError ||
    error instanceof StaffNotFoundError ||
    error instanceof StaffValidationError
  ) {
    return error.message;
  }
  return fallback;
}

/* ---------------- Candidate lookup ---------------- */

export async function lookupStaffCandidateAction(
  _previous: StaffLookupState,
  formData: FormData,
): Promise<StaffLookupState> {
  const user = await requireCurrentUser();
  const email = String(formData.get("email") ?? "");
  const role = parseRole(formData.get("role")) ?? "STAFF";
  try {
    const candidate = await findStaffCandidateByEmail(user.id, email);
    return { ok: true, message: null, email, role, candidate };
  } catch (error) {
    return {
      ok: false,
      message: toSafeMessage(error, "Could not look up that account."),
      email,
      role,
      candidate: null,
    };
  }
}

/* ---------------- Mutations ---------------- */

export async function addStaffAction(
  _previous: StaffMutationState,
  formData: FormData,
): Promise<StaffMutationState> {
  const user = await requireCurrentUser();
  const email = String(formData.get("email") ?? "");
  const role = parseRole(formData.get("role"));
  if (!role) {
    return { ok: false, message: "Choose a valid role." };
  }
  try {
    await addOrganizationStaff(user.id, { email, role });
  } catch (error) {
    return {
      ok: false,
      message: toSafeMessage(error, "Could not add that staff member."),
    };
  }
  revalidatePath(STAFF_PATH);
  return { ok: true, message: "Staff access added." };
}

export async function changeStaffRoleAction(
  _previous: StaffMutationState,
  formData: FormData,
): Promise<StaffMutationState> {
  const user = await requireCurrentUser();
  const membershipId = String(formData.get("membershipId") ?? "");
  const role = parseRole(formData.get("role"));
  if (!membershipId || !role) {
    return { ok: false, message: "Choose a valid role." };
  }
  try {
    await changeOrganizationStaffRole(user.id, { membershipId, role });
  } catch (error) {
    // Refresh either way: on a conflict or a vanished row the list the
    // manager is looking at is stale.
    revalidatePath(STAFF_PATH);
    return {
      ok: false,
      message: toSafeMessage(error, "Could not change that role."),
    };
  }
  revalidatePath(STAFF_PATH);
  return { ok: true, message: "Role updated." };
}

export async function revokeStaffAccessAction(
  _previous: StaffMutationState,
  formData: FormData,
): Promise<StaffMutationState> {
  const user = await requireCurrentUser();
  const membershipId = String(formData.get("membershipId") ?? "");
  if (!membershipId) {
    return { ok: false, message: "That staff access no longer exists." };
  }
  try {
    await revokeOrganizationStaffAccess(user.id, { membershipId });
  } catch (error) {
    revalidatePath(STAFF_PATH);
    return {
      ok: false,
      message: toSafeMessage(error, "Could not revoke that access."),
    };
  }
  revalidatePath(STAFF_PATH);
  return { ok: true, message: "Access revoked." };
}
