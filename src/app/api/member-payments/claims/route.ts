import { NextResponse } from "next/server";

import { PaymentValidationError } from "@/lib/members";
import {
  getMemberContext,
  isSameOriginRequest,
} from "@/lib/server/member-session";
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
import {
  PaymentClaimAuthorizationError,
  PaymentClaimDuplicateError,
  PaymentClaimLimitError,
  PaymentClaimNotFoundError,
  memberClaimScope,
  submitPaymentClaim,
} from "@/lib/server/payment-claims";
import { SubscriptionRestrictedError } from "@/lib/server/subscriptions";

/**
 * POST /api/member-payments/claims — a member tells their gym "I paid".
 *
 * Authenticated solely by the gym-scoped member session cookie
 * (ADR 021): user, organization, and member all come from the resolved
 * session context via memberClaimScope — the request body carries only
 * the payment details (amount, method, reference). Any identity fields
 * a client sends are ignored entirely. A submitted claim is NOT a
 * confirmed payment: it counts toward the member's balance only after
 * gym staff verify it (see payment-claims.ts).
 *
 * Guard order mirrors the member check-in route: origin first (the
 * request is authenticated by the cookie alone), then the session,
 * then body shape, then the service — whose validation, duplicate
 * block, and pending cap are the authoritative checks.
 */
export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request);
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Request origin could not be verified.",
        },
      },
      { status: 403 },
    );
  }

  const context = await getMemberContext();
  if (!context) {
    return NextResponse.json(
      {
        error: {
          code: "UNAUTHENTICATED",
          message: "Sign in required.",
        },
      },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return genericFailure();
  }
  const fields = (body ?? {}) as {
    amount?: unknown;
    paymentMethod?: unknown;
    reference?: unknown;
  };
  if (
    typeof fields.amount !== "string" ||
    typeof fields.paymentMethod !== "string"
  ) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Enter the amount and how you paid.",
        },
      },
      { status: 400 },
    );
  }
  const reference =
    typeof fields.reference === "string" ? fields.reference : "";

  try {
    const { claimId } = await submitPaymentClaim(memberClaimScope(context), {
      amount: fields.amount,
      paymentMethod: fields.paymentMethod,
      reference,
    });
    return NextResponse.json(
      { result: "claim_submitted", claimId },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof PaymentClaimAuthorizationError) {
      return NextResponse.json(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "Sign in required.",
          },
        },
        { status: 401 },
      );
    }
    if (error instanceof SubscriptionRestrictedError) {
      return NextResponse.json(
        {
          error: {
            code: "SUBSCRIPTION_RESTRICTED",
            message:
              "This gym's subscription is currently restricted. Please ask the gym for help.",
          },
        },
        { status: 403 },
      );
    }
    if (error instanceof PaymentValidationError) {
      const message =
        error.errors.amount ??
        error.errors.paymentMethod ??
        error.errors.reference ??
        error.errors.form ??
        "Please check the payment details.";
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message } },
        { status: 400 },
      );
    }
    if (error instanceof PaymentClaimDuplicateError) {
      return NextResponse.json(
        {
          error: {
            code: "DUPLICATE_CLAIM",
            message:
              "You've already told us about this payment. It's waiting for the gym to verify it.",
          },
        },
        { status: 409 },
      );
    }
    if (error instanceof PaymentClaimLimitError) {
      return NextResponse.json(
        {
          error: {
            code: "TOO_MANY_PENDING_CLAIMS",
            message:
              "You have several payments waiting for verification. Please wait for the gym to verify them before adding another.",
          },
        },
        { status: 409 },
      );
    }
    if (error instanceof PaymentClaimNotFoundError) {
      return genericFailure();
    }
    if (classifyDatabaseError(error)) {
      logDatabaseFailure({
        boundary: "POST /api/member-payments/claims",
        requestId,
        error,
      });
      return withCorrelationId(
        NextResponse.json(DATABASE_UNAVAILABLE_BODY, { status: 503 }),
        requestId,
      );
    }
    logUnexpectedError({
      boundary: "POST /api/member-payments/claims",
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
        code: "CLAIM_FAILED",
        message: "We couldn't record that payment. Please see the front desk.",
      },
    },
    { status: 400 },
  );
}
