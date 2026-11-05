import "server-only";

import { SmsProviderError, type SmsProvider } from "./sms-provider";

/**
 * APITxT SMS OTP delivery provider.
 *
 * This is the ONLY module that knows the APITxT endpoint, request shape,
 * or API key. Deliberate choices:
 * - Delivery only. APITxT documents a send endpoint and no verification
 *   endpoint; the application generates the OTP and verifies it locally
 *   against a stored HMAC digest (see otp-service.ts / otp-crypto.ts).
 *   The response's data.request_id is a delivery request identifier —
 *   it is not stored and never used as a verification mechanism.
 * - POST with an application/x-www-form-urlencoded body, so the API key
 *   and the OTP travel in the request body, never in the URL.
 * - No template_id / template_name is sent: the account's configured
 *   default SMS OTP route is used.
 * - The API key is read lazily from APITXT_API_KEY on each call — it is
 *   intentionally NOT a required application-wide env var, so
 *   deployments without member OTP keep working; invoking the provider
 *   unconfigured fails closed with NOT_CONFIGURED.
 * - NOTHING about the request or response (body, key, OTP, upstream
 *   payload, raw fetch error) is ever logged or thrown: every failure
 *   is normalized to a SmsProviderError with a generic message.
 */

const SEND_OTP_URL = "https://apitxt.com/api/sendOTP";
const REQUEST_TIMEOUT_MS = 10_000;

interface ApiTxtResponse {
  status?: unknown;
}

function readApiKey(): string {
  const key = process.env.APITXT_API_KEY;
  if (!key) {
    throw new SmsProviderError("NOT_CONFIGURED");
  }
  return key;
}

class ApiTxtProvider implements SmsProvider {
  async sendOtp(phoneNumber: string, otp: string): Promise<void> {
    const authkey = readApiKey();

    // Canonical 10-digit application number → provider form: Indian
    // number with country code and no "+" (e.g. 919876543210).
    const body = new URLSearchParams({
      authkey,
      mobile: `91${phoneNumber}`,
      otp,
      channel: "sms",
      country: "91",
    });

    let response: Response;
    try {
      response = await fetch(SEND_OTP_URL, {
        method: "POST",
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // Transport failure or timeout. The raw error is discarded: it
      // can embed request details that must never surface.
      throw new SmsProviderError("PROVIDER_UNAVAILABLE");
    }
    if (!response.ok) {
      throw new SmsProviderError("PROVIDER_UNAVAILABLE");
    }

    let parsed: ApiTxtResponse;
    try {
      parsed = (await response.json()) as ApiTxtResponse;
    } catch {
      throw new SmsProviderError("PROVIDER_UNAVAILABLE");
    }
    // The documented success shape is { status: "success", ... }.
    // Anything else is a provider rejection; the upstream payload is
    // never propagated.
    if (parsed.status !== "success") {
      throw new SmsProviderError("PROVIDER_REJECTED");
    }
  }
}

/** Shared provider instance. Stateless; the key is read per call. */
export const apiTxtProvider: SmsProvider = new ApiTxtProvider();
