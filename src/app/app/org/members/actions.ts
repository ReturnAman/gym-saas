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
  PaymentAuthorizationError,
  PaymentIdempotencyConflictError,
  PaymentNotFoundError,
  recordPayment,
} from "@/lib/server/payments";
import {
  classifyDatabaseError,
  DATABASE_TEMPORARILY_UNAVAILABLE_MESSAGE,
  mayHaveCommitted,
} from "@/lib/server/db-errors";
import {
  logDatabaseFailure,
  logUnexpectedError,
} from "@/lib/server/logger";
import {
  MemberValidationError,
  PaymentValidationError,
  type MemberField,
  type PaymentField,
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
    if (classifyDatabaseError(error)) {
      return {
        ok: false,
        message: DATABASE_TEMPORARILY_UNAVAILABLE_MESSAGE,
        errors: {},
        duplicates: [],
      };
    }
    // Unknown failures get a generic message — never leak internals.
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
    if (classifyDatabaseError(error)) {
      return {
        ok: false,
        message: DATABASE_TEMPORARILY_UNAVAILABLE_MESSAGE,
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

export interface PaymentFormState {
  ok: boolean;
  message: string | null;
  errors: Partial<Record<PaymentField | "form", string>>;
}

export const INITIAL_PAYMENT_FORM_STATE: PaymentFormState = {
  ok: false,
  message: null,
  errors: {},
};

/**
 * Record-payment submit handler.
 *
 * Authentication is enforced by requireCurrentUser (redirects to sign-in);
 * OWNER/ADMIN/STAFF authorization, tenant isolation, and input validation
 * are enforced inside recordPayment, server-side. The member ID comes from
 * a hidden field but is never trusted: recordPayment re-verifies it against
 * the caller's organization. On success the payment and its audit event
 * exist (atomically), and the user returns to the member's page, so a
 * refresh cannot replay the recording.
 */
export async function recordPaymentAction(
  _prevState: PaymentFormState,
  formData: FormData,
): Promise<PaymentFormState> {
  const user = await requireCurrentUser();
  const memberId = String(formData.get("memberId") ?? "");

  try {
    const idempotencyToken = String(formData.get("idempotencyToken") ?? "");
    await recordPayment(
      user.id,
      memberId,
      {
        amount: String(formData.get("amount") ?? ""),
        paymentMethod: String(formData.get("paymentMethod") ?? ""),
        reference: String(formData.get("reference") ?? ""),
      },
      idempotencyToken ? { idempotencyKey: idempotencyToken } : undefined,
    );
  } catch (error) {
    if (error instanceof PaymentValidationError) {
      return { ok: false, message: null, errors: error.errors };
    }
    if (error instanceof PaymentIdempotencyConflictError) {
      return {
        ok: false,
        message:
          "This payment submission was already used with different details. Refresh the page and check the payment history before recording again.",
        errors: {},
      };
    }
    if (
      error instanceof PaymentAuthorizationError ||
      error instanceof PaymentNotFoundError
    ) {
      return { ok: false, message: error.message, errors: {} };
    }
    if (mayHaveCommitted(error)) {
      logDatabaseFailure({ boundary: "action:recordPayment", error });
      // The connection died around the write: the payment may or may
      // not be recorded — never invite a blind retry. Refresh the
      // member's pages so the history and balance the staff member is
      // sent to check are the persisted ones.
      revalidatePath("/app/org/members");
      revalidatePath(`/app/org/members/${memberId}`);
      return {
        ok: false,
        message:
          "We couldn't confirm whether this payment was recorded — the database connection was interrupted. Please check the member's payment history and balance before recording it again.",
        errors: {},
      };
    }
    if (classifyDatabaseError(error)) {
      logDatabaseFailure({ boundary: "action:recordPayment", error });
      // Pool-acquisition or statement timeout: the transaction never
      // started or was aborted by the database — nothing was recorded,
      // so a plain retry is safe.
      return {
        ok: false,
        message:
          "The database didn't respond in time, so this payment was not recorded. Please try again.",
        errors: {},
      };
    }
    logUnexpectedError({ boundary: "action:recordPayment", error });
    // Unknown failures get a generic message — never leak internals.
    return {
      ok: false,
      message: "Could not record the payment. Please try again.",
      errors: {},
    };
  }

  revalidatePath("/app/org/members");
  revalidatePath(`/app/org/members/${memberId}`);
  redirect(`/app/org/members/${memberId}`);
}
