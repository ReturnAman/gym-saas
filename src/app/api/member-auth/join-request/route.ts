import { NextResponse } from "next/server";

import {
  resolveCorrelationId,
  withCorrelationId,
} from "@/lib/server/correlation";
import {
  classifyDatabaseError,
  DATABASE_UNAVAILABLE_BODY,
} from "@/lib/server/db-errors";
import {
  logDatabaseFailure,
  logUnexpectedError,
} from "@/lib/server/logger";
import { submitMemberJoinRequest } from "@/lib/server/member-auth";
import {
  MemberJoinRequestError,
  MemberJoinRequestValidationError,
} from "@/lib/server/member-join-requests";
import { isSameOriginRequest } from "@/lib/server/member-session";

/**
 * POST /api/member-auth/join-request — submit a request to join a gym.
 *
 * Public member-auth endpoint (no Clerk — the member path is phone
 * OTP, ADR 021). The caller presents a VERIFIED OTP challenge for the
 * gym; the service independently validates the challenge, takes the
 * phone from it (never from the body), and re-checks existing member
 * records before creating anything. A created request is PENDING for
 * staff review: it confirms no membership, fee, or payment, and no
 * session is issued.
 *
 * Response contract: field-validation problems with the caller's own
 * input are detailed (400); the two outcomes about the caller's own
 * verified number are distinguishable (already pending → 200, already
 * registered → 409); EVERY other failure — unknown, wrong-gym,
 * unverified, consumed, or out-of-window challenge, or an existing
 * record that must not be bypassed — returns the same generic body,
 * indistinguishable by design.
 */
export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request);
  if (!isSameOriginRequest(request)) {
    return genericFailure();
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return genericFailure();
  }
  const fields = (body ?? {}) as {
    organizationId?: unknown;
    challengeId?: unknown;
    name?: unknown;
    requestedPlan?: unknown;
    proposedFee?: unknown;
    proposedStartDate?: unknown;
  };
  if (
    typeof fields.organizationId !== "string" ||
    fields.organizationId.trim() === "" ||
    typeof fields.challengeId !== "string" ||
    fields.challengeId.trim() === ""
  ) {
    return genericFailure();
  }
  // The detail fields are validated authoritatively by the service;
  // a non-string value is simply an absent one for validation.
  const asString = (value: unknown): string =>
    typeof value === "string" ? value : "";

  try {
    const result = await submitMemberJoinRequest({
      organizationId: fields.organizationId,
      challengeId: fields.challengeId,
      name: asString(fields.name),
      requestedPlan: asString(fields.requestedPlan),
      proposedFee: asString(fields.proposedFee),
      proposedStartDate: asString(fields.proposedStartDate),
    });
    if (result.status === "created") {
      return NextResponse.json({ requested: true }, { status: 201 });
    }
    if (result.status === "already_pending") {
      return NextResponse.json(
        { requested: true, alreadyPending: true },
        { status: 200 },
      );
    }
    return NextResponse.json(
      {
        error: {
          code: "ALREADY_REGISTERED",
          message:
            "This phone number is already registered at this gym. Please sign in, or see the front desk if you need help.",
        },
      },
      { status: 409 },
    );
  } catch (error) {
    if (error instanceof MemberJoinRequestValidationError) {
      const message =
        error.fields.name ??
        error.fields.plan ??
        error.fields.fee ??
        error.fields.startDate ??
        "Please check the details and try again.";
      return NextResponse.json(
        {
          error: { code: "VALIDATION_ERROR", message, fields: error.fields },
        },
        { status: 400 },
      );
    }
    if (error instanceof MemberJoinRequestError) {
      return genericFailure();
    }
    if (classifyDatabaseError(error)) {
      logDatabaseFailure({
        boundary: "POST /api/member-auth/join-request",
        requestId,
        error,
      });
      return withCorrelationId(
        NextResponse.json(DATABASE_UNAVAILABLE_BODY, { status: 503 }),
        requestId,
      );
    }
    logUnexpectedError({
      boundary: "POST /api/member-auth/join-request",
      requestId,
      error,
    });
    return withCorrelationId(
      NextResponse.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Something went wrong. Please try again.",
          },
        },
        { status: 500 },
      ),
      requestId,
    );
  }
}

function genericFailure() {
  return NextResponse.json(
    {
      error: {
        code: "JOIN_REQUEST_FAILED",
        message:
          "We could not send your request. Please request a new code and try again, or ask the gym for help.",
      },
    },
    { status: 400 },
  );
}
