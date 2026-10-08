import "server-only";

import { SmsProviderError, type SmsProvider } from "./sms-provider";

/**
 * 2Factor SMS OTP provider (AUTOGEN / VERIFY).
 *
 * This is the ONLY module that knows 2Factor endpoints, response shapes, or
 * the API key. Deliberate choices:
 * - AUTOGEN only: the provider generates a 6-digit OTP. AUTOGEN2 is not
 *   used (it returns the OTP itself to the application) and AUTOGEN3 is not
 *   used (4-digit OTPs). The application never generates or stores an OTP.
 * - The API key is read lazily from TWOFACTOR_API_KEY on each call — it is
 *   intentionally NOT a required application-wide env var, so deployments
 *   without member OTP keep working; invoking the provider unconfigured
 *   fails closed with NOT_CONFIGURED.
 * - The API key is part of the request URL, so NOTHING about the request
 *   (URL, upstream body, raw fetch error) is ever logged or thrown: every
 *   failure is normalized to a SmsProviderError with a generic message.
 * - Phone numbers arrive in the canonical 10-digit application format and
 *   are converted here to the provider form (+91…).
 */

const API_BASE = "https://2factor.in/API/V1";
const REQUEST_TIMEOUT_MS = 10_000;

interface TwoFactorResponse {
  Status?: unknown;
  Details?: unknown;
}

function readApiKey(): string {
  const key = process.env.TWOFACTOR_API_KEY;
  if (!key) {
    throw new SmsProviderError("NOT_CONFIGURED");
  }
  return key;
}

/**
 * Call 2Factor and return the parsed body. Any transport failure, non-200
 * status, or unparseable body becomes PROVIDER_UNAVAILABLE — the raw error
 * is discarded because it can contain the request URL (and thus the key).
 */
async function callTwoFactor(path: string): Promise<TwoFactorResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/${path}`, {
      method: "GET",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new SmsProviderError("PROVIDER_UNAVAILABLE");
  }
  if (!response.ok) {
    throw new SmsProviderError("PROVIDER_UNAVAILABLE");
  }
  try {
    return (await response.json()) as TwoFactorResponse;
  } catch {
    throw new SmsProviderError("PROVIDER_UNAVAILABLE");
  }
}

class TwoFactorProvider implements SmsProvider {
  async sendOtp(phoneNumber: string): Promise<{ providerSessionId: string }> {
    const apiKey = readApiKey();
    // Canonical 10-digit application number → provider form (+91…).
    const providerPhone = encodeURIComponent(`+91${phoneNumber}`);
    const body = await callTwoFactor(
      `${apiKey}/SMS/${providerPhone}/AUTOGEN`,
    );
    if (body.Status !== "Success") {
      throw new SmsProviderError("PROVIDER_REJECTED");
    }
    if (typeof body.Details !== "string" || body.Details === "") {
      throw new SmsProviderError("PROVIDER_REJECTED");
    }
    // Details is the OTP session/request identifier used later by VERIFY.
    return { providerSessionId: body.Details };
  }

  async verifyOtp(
    providerSessionId: string,
    otp: string,
  ): Promise<{ verified: boolean }> {
    const apiKey = readApiKey();
    const body = await callTwoFactor(
      `${apiKey}/SMS/VERIFY/${encodeURIComponent(providerSessionId)}/${encodeURIComponent(otp)}`,
    );
    // A mismatched or expired OTP comes back as a non-Success status —
    // that is a normal verification failure, not a provider error.
    return { verified: body.Status === "Success" };
  }
}

/** Shared provider instance. Stateless; the key is read per call. */
export const twoFactorProvider: SmsProvider = new TwoFactorProvider();
