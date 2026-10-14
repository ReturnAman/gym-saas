"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { formatDate, parseDateInput } from "@/lib/members";
import { requireCurrentUser } from "@/lib/server/auth";
import {
  classifyDatabaseError,
  DATABASE_TEMPORARILY_UNAVAILABLE_MESSAGE,
} from "@/lib/server/db-errors";
import {
  AttendanceAlreadyCheckedInError,
  AttendanceAuthorizationError,
  AttendanceConfirmationRequiredError,
  AttendanceNoMembershipError,
  AttendanceNotFoundError,
  checkInMember,
  checkOutAllOpenSessions,
  checkOutMember,
} from "@/lib/server/attendance";

/**
 * Attendance form state (staff manual check-in/check-out).
 *
 * `requiresExpiredConfirmation` is the second step of the expired-
 * membership flow: the service re-derives membership status server-side
 * on every submission, and only when it reports EXPIRED does the action
 * return this state; the form then renders the warning and an explicit
 * "Check in anyway" submission carrying the confirmation flag.
 */
export interface AttendanceFormState {
  ok: boolean;
  message: string | null;
  errors: Partial<Record<"form", string>>;
  requiresExpiredConfirmation?: boolean;
  /** Membership expiry date ("YYYY-MM-DD") when confirmation is required. */
  expiredOn?: string | null;
}

export const INITIAL_ATTENDANCE_FORM_STATE: AttendanceFormState = {
  ok: false,
  message: null,
  errors: {},
  requiresExpiredConfirmation: false,
  expiredOn: null,
};

/** Where the submitting form lives; determines the post-success redirect. */
function originPath(from: string, memberId: string): string {
  if (from === "gym" || !memberId) return "/app/org/attendance";
  return `/app/org/members/${memberId}`;
}

function revalidateAttendance(memberId: string): void {
  revalidatePath("/app/org/attendance");
  if (memberId) {
    revalidatePath(`/app/org/members/${memberId}`);
  }
}

function displayDate(isoDate: string): string {
  const parsed = parseDateInput(isoDate);
  return parsed ? formatDate(parsed) : isoDate;
}

/**
 * Check-in submit handler.
 *
 * Authentication is enforced by requireCurrentUser (redirects to
 * sign-in); check-in authorization (OWNER/ADMIN/STAFF/TRAINER), tenant
 * isolation, the one-open-session rule, and the membership-status
 * check are enforced inside checkInMember, server-side. The member ID comes from a hidden
 * field but is never trusted: the service re-verifies it against the
 * caller's organization, and re-derives the membership status from the
 * database — never from anything the client sent.
 */
export async function checkInMemberAction(
  _prevState: AttendanceFormState,
  formData: FormData,
): Promise<AttendanceFormState> {
  const user = await requireCurrentUser();
  const memberId = String(formData.get("memberId") ?? "");
  const from = String(formData.get("from") ?? "member");
  const confirmExpiredMembership =
    formData.get("confirmExpiredMembership") === "1";

  try {
    await checkInMember(user.id, memberId, { confirmExpiredMembership });
  } catch (error) {
    if (error instanceof AttendanceConfirmationRequiredError) {
      // Not an error state the user must fix by editing input — a held
      // submission awaiting an explicit decision. No redirect: the form
      // re-renders in place with the warning and the confirm button.
      return {
        ok: false,
        message: `This member's membership expired on ${displayDate(error.membershipExpiredOn)}.`,
        errors: {},
        requiresExpiredConfirmation: true,
        expiredOn: error.membershipExpiredOn,
      };
    }
    if (
      error instanceof AttendanceAlreadyCheckedInError ||
      error instanceof AttendanceNoMembershipError ||
      error instanceof AttendanceAuthorizationError ||
      error instanceof AttendanceNotFoundError
    ) {
      return { ok: false, message: error.message, errors: {} };
    }
    if (classifyDatabaseError(error)) {
      return {
        ok: false,
        message: DATABASE_TEMPORARILY_UNAVAILABLE_MESSAGE,
        errors: {},
      };
    }
    // Unknown failures get a generic message — never leak internals.
    return {
      ok: false,
      message: "Could not check the member in. Please try again.",
      errors: {},
    };
  }

  revalidateAttendance(memberId);
  redirect(originPath(from, memberId));
}

/**
 * Check-out submit handler. Idempotent server-side: a repeated check-out
 * of an already-closed session succeeds without duplicating the audit
 * event, so a double submission simply returns the user to the page.
 */
export async function checkOutMemberAction(
  _prevState: AttendanceFormState,
  formData: FormData,
): Promise<AttendanceFormState> {
  const user = await requireCurrentUser();
  const sessionId = String(formData.get("sessionId") ?? "");
  const memberId = String(formData.get("memberId") ?? "");
  const from = String(formData.get("from") ?? "member");

  try {
    await checkOutMember(user.id, sessionId);
  } catch (error) {
    if (
      error instanceof AttendanceAuthorizationError ||
      error instanceof AttendanceNotFoundError
    ) {
      return { ok: false, message: error.message, errors: {} };
    }
    if (classifyDatabaseError(error)) {
      return {
        ok: false,
        message: DATABASE_TEMPORARILY_UNAVAILABLE_MESSAGE,
        errors: {},
      };
    }
    return {
      ok: false,
      message: "Could not check the member out. Please try again.",
      errors: {},
    };
  }

  revalidateAttendance(memberId);
  redirect(originPath(from, memberId));
}

/**
 * End-of-day submit handler: closes every open session in the caller's
 * gym (each actual close is audited server-side). Lives on the gym
 * attendance page, so success always returns there.
 */
export async function checkOutAllOpenSessionsAction(
  _prevState: AttendanceFormState,
  formData: FormData,
): Promise<AttendanceFormState> {
  const user = await requireCurrentUser();
  const from = String(formData.get("from") ?? "gym");

  try {
    await checkOutAllOpenSessions(user.id);
  } catch (error) {
    if (error instanceof AttendanceAuthorizationError) {
      return { ok: false, message: error.message, errors: {} };
    }
    if (classifyDatabaseError(error)) {
      return {
        ok: false,
        message: DATABASE_TEMPORARILY_UNAVAILABLE_MESSAGE,
        errors: {},
      };
    }
    return {
      ok: false,
      message: "Could not check everyone out. Please try again.",
      errors: {},
    };
  }

  revalidatePath("/app/org/attendance");
  redirect(originPath(from, ""));
}
