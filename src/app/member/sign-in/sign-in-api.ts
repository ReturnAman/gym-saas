"use client";

import {
  SignInApiError,
  type JoinSubmitResult,
  type SignInApi,
} from "@/lib/member-sign-in-flow";

/**
 * Fetch implementation of the sign-in flow's API surface, over the
 * existing member-auth routes (whose behavior is unchanged):
 *
 * - POST /api/member-auth/otp/request → 200 { challengeId };
 *   400 VALIDATION_ERROR; 503 OTP_UNAVAILABLE; 500 INTERNAL_ERROR.
 *   The body carries `intent: "join"` only on the join journey.
 * - POST /api/member-auth/otp/verify → 200 { verified: true };
 *   every failure is the same generic 400 (503 on provider outage).
 * - POST /api/member-auth/link → 200 { linked: true } + session
 *   cookie; every failure is the same generic 400.
 * - POST /api/member-auth/join-request → 201 { requested: true };
 *   200 already pending; 409 ALREADY_REGISTERED; 400 VALIDATION_ERROR
 *   with per-field messages; every other failure the generic 400.
 *   The distinguishable outcomes are returned as a JoinSubmitResult;
 *   the generic failures throw like the other calls.
 *
 * A non-OK response becomes a SignInApiError carrying the HTTP status
 * (and the body's error code when parseable); a rejected fetch becomes
 * a SignInApiError with a null status, which the flow reads as "no
 * response arrived" rather than "the server said no".
 */
async function postJson(
  path: string,
  body: Record<string, string>,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new SignInApiError(null, null);
  }

  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = (json as { error?: { code?: unknown } } | null)?.error?.code;
    throw new SignInApiError(
      response.status,
      typeof code === "string" ? code : null,
    );
  }
  return json;
}

export const memberSignInApi: SignInApi = {
  async requestOtp(input) {
    const json = await postJson("/api/member-auth/otp/request", {
      organizationId: input.organizationId,
      phoneNumber: input.phoneNumber,
      // Intent travels only when the flow declares it (the join
      // journey); the sign-in journey's body is unchanged.
      ...(input.intent ? { intent: input.intent } : {}),
    });
    const challengeId = (json as { challengeId?: unknown } | null)
      ?.challengeId;
    if (typeof challengeId !== "string" || challengeId === "") {
      // A 200 without a usable challenge id cannot drive the flow;
      // surface it as a response-less failure so the member can retry.
      throw new SignInApiError(null, null);
    }
    return { challengeId };
  },

  async verifyOtp(input) {
    await postJson("/api/member-auth/otp/verify", input);
  },

  async link(input) {
    await postJson("/api/member-auth/link", input);
  },

  async submitJoinRequest(input): Promise<JoinSubmitResult> {
    let response: Response;
    try {
      response = await fetch("/api/member-auth/join-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
    } catch {
      throw new SignInApiError(null, null);
    }
    const json: unknown = await response.json().catch(() => null);
    if (response.status === 201) {
      return { outcome: "created" };
    }
    if (response.status === 200) {
      return { outcome: "already_pending" };
    }
    const error = (
      json as {
        error?: {
          code?: unknown;
          fields?: Partial<Record<string, string>>;
        };
      } | null
    )?.error;
    const code = typeof error?.code === "string" ? error.code : null;
    if (response.status === 409 && code === "ALREADY_REGISTERED") {
      return { outcome: "already_registered" };
    }
    if (response.status === 400 && code === "VALIDATION_ERROR") {
      return { outcome: "validation_error", fields: error?.fields ?? {} };
    }
    throw new SignInApiError(response.status, code);
  },
};
