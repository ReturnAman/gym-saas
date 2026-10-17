"use server";

import { revalidatePath } from "next/cache";

import { requireCurrentUser } from "@/lib/server/auth";
import {
  classifyDatabaseError,
  mayHaveCommitted,
} from "@/lib/server/db-errors";
import {
  logDatabaseFailure,
  logUnexpectedError,
} from "@/lib/server/logger";
import {
  MemberJoinRequestAlreadyDecidedError,
  MemberJoinRequestAuthorizationError,
  MemberJoinRequestDecisionConflictError,
  MemberJoinRequestNotFoundError,
  MemberJoinRequestValidationError,
  approveJoinRequest,
  rejectJoinRequest,
} from "@/lib/server/member-join-requests";

import type { JoinRequestDecisionState } from "./join-requests-action-state";

/**
 * Server actions for the staff join-request queue (Slice 2).
 *
 * Authentication comes from requireCurrentUser (redirects to
 * sign-in); the request's organization, role authorization (OWNER /
 * ADMIN / STAFF), the decision's transactional safety, and audit
 * events are all enforced inside the member-join-requests service.
 * These actions only translate form data into service calls and
 * service outcomes into safe UI state. The only user input read is
 * the request ID and, for approval, the confirmed membership terms;
 * no client-submitted value ever steers authorization, scoping, or
 * cache revalidation — after a decision only the fixed paths below
 * are revalidated. (Member pages are server-rendered per request,
 * so they pick up a created member on their next load regardless.)
 */

const QUEUE_PATH = "/app/org/join-requests";
const MEMBERS_PATH = "/app/org/members";

function revalidateDecisionSurfaces() {
  revalidatePath(QUEUE_PATH);
  revalidatePath(MEMBERS_PATH);
}

function noLongerAvailable(): JoinRequestDecisionState {
  return {
    ok: false,
    message: "This request is no longer available.",
    errors: {},
  };
}

function mapDecisionError(error: unknown): JoinRequestDecisionState {
  if (error instanceof MemberJoinRequestValidationError) {
    return { ok: false, message: null, errors: error.fields };
  }
  if (error instanceof MemberJoinRequestAlreadyDecidedError) {
    // Another staff member (or a double submit) already decided
    // this request. Refresh the queue so it disappears.
    revalidateDecisionSurfaces();
    return {
      ok: false,
      message: "This request has already been decided.",
      errors: {},
    };
  }
  if (error instanceof MemberJoinRequestDecisionConflictError) {
    // The member records for this phone need staff attention before
    // the request can be approved; it stays pending. The messages
    // describe the caller's own gym records only.
    return {
      ok: false,
      message:
        error.reason === "member_has_membership"
          ? "This member already has a membership, so approving would create a second one. The request is still pending — check the member's record first."
          : error.reason === "duplicate_member_records"
            ? "There are multiple member records for this phone number. Resolve the duplicates in Members first — the request is still pending."
            : "This phone number is linked to a different member account. Check the member records first — the request is still pending.",
      errors: {},
    };
  }
  if (
    error instanceof MemberJoinRequestAuthorizationError ||
    error instanceof MemberJoinRequestNotFoundError
  ) {
    return noLongerAvailable();
  }
  if (mayHaveCommitted(error)) {
    logDatabaseFailure({ boundary: "action:joinRequestDecision", error });
    // Approval creates a member and a membership: a lost connection
    // may mean the decision committed anyway. Refresh the queue and
    // send staff to the request's persisted state rather than
    // inviting a blind second decision.
    revalidateDecisionSurfaces();
    return {
      ok: false,
      message:
        "We couldn't confirm whether this decision was saved — the database connection was interrupted. The list has been refreshed; check whether the request is still pending before deciding again.",
      errors: {},
    };
  }
  if (classifyDatabaseError(error)) {
    logDatabaseFailure({ boundary: "action:joinRequestDecision", error });
    return {
      ok: false,
      message:
        "The database didn't respond in time, so this decision was not saved. Please try again.",
      errors: {},
    };
  }
  logUnexpectedError({ boundary: "action:joinRequestDecision", error });
  // Unknown failures get a generic message — never leak internals.
  return {
    ok: false,
    message: "Something went wrong. Please try again.",
    errors: {},
  };
}

/**
 * Approve a join request: creates (or adopts) the member and their
 * first membership on the confirmed terms, via the
 * member-join-requests service — the only code path that turns a
 * request into a member. No payment is created; the fee starts out
 * outstanding.
 */
export async function approveJoinRequestAction(
  _prevState: JoinRequestDecisionState,
  formData: FormData,
): Promise<JoinRequestDecisionState> {
  const user = await requireCurrentUser();
  const requestId = String(formData.get("requestId") ?? "");
  if (!requestId) {
    return noLongerAvailable();
  }
  try {
    await approveJoinRequest(user.id, requestId, {
      plan: String(formData.get("plan") ?? ""),
      fee: String(formData.get("fee") ?? ""),
      startDate: String(formData.get("startDate") ?? ""),
    });
  } catch (error) {
    return mapDecisionError(error);
  }
  revalidateDecisionSurfaces();
  return {
    ok: true,
    message:
      "Approved — the member and their membership have been created. No payment has been recorded; the fee is outstanding until it is paid.",
    errors: {},
  };
}

/** Reject a join request: nothing is created; the service audits it. */
export async function rejectJoinRequestAction(
  _prevState: JoinRequestDecisionState,
  formData: FormData,
): Promise<JoinRequestDecisionState> {
  const user = await requireCurrentUser();
  const requestId = String(formData.get("requestId") ?? "");
  if (!requestId) {
    return noLongerAvailable();
  }
  try {
    await rejectJoinRequest(user.id, requestId);
  } catch (error) {
    return mapDecisionError(error);
  }
  revalidateDecisionSurfaces();
  return { ok: true, message: "Request rejected.", errors: {} };
}
