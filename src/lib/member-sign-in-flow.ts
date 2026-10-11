/**
 * Member sign-in flow — a framework-free state machine for the
 * phone → OTP → link journey (02-USER-FLOWS §9, ADR 021). The React
 * form (app/member/sign-in) is a thin renderer over this class, so the
 * full behavior — validation, cooldown, error mapping, duplicate
 * protection — is unit-testable without a browser.
 *
 * Security invariants held here:
 * - Anti-enumeration copy: the UI never claims a code was dispatched.
 *   A 200 from the request endpoint is answered with neutral wording,
 *   because eligible, ineligible, and rate-limited phones all produce
 *   the same response server-side.
 * - The challenge id is private to this class: it never appears in the
 *   renderable state, storage, or URLs.
 * - The link response is never trusted: after a verify (or a verify
 *   whose response was lost), link is attempted exactly once and the
 *   flow then hands off to `onProbe` — navigation to the check-in
 *   landing, which renders from the actual session. A consumed
 *   challenge is never blindly retried.
 * - One flow instance is scoped to one gym. Gym changes go through
 *   `reset()` (the form also remounts per gym via React key).
 */

export const OTP_RESEND_COOLDOWN_MS = 30_000;

export const OTP_REQUEST_INFO_COPY =
  "If this number is eligible, a code will arrive shortly.";
export const OTP_FAILURE_COPY =
  "That code didn't work. It may be wrong, expired, or too many attempts were made.";
export const SMS_UNAVAILABLE_COPY =
  "SMS service is temporarily unavailable. Please try again later.";
export const CONNECTION_ERROR_COPY =
  "Could not continue. Check your connection and try again.";
export const PHONE_ERROR_COPY = "Enter a valid 10-digit mobile number.";

/**
 * Failure of a sign-in API call. `status` is the HTTP status, or null
 * when no response arrived at all (network failure) — the distinction
 * matters for verify, where a lost response may hide a server-side
 * success.
 */
export class SignInApiError extends Error {
  readonly status: number | null;
  readonly code: string | null;

  constructor(status: number | null, code: string | null) {
    super(
      status === null
        ? "Sign-in request failed without a response."
        : `Sign-in request failed with status ${status}.`,
    );
    this.name = "SignInApiError";
    this.status = status;
    this.code = code;
  }
}

/** The member-auth API surface the flow depends on (fetch in the app). */
export interface SignInApi {
  requestOtp(input: {
    organizationId: string;
    phoneNumber: string;
  }): Promise<{ challengeId: string }>;
  verifyOtp(input: {
    organizationId: string;
    challengeId: string;
    otp: string;
  }): Promise<void>;
  link(input: {
    organizationId: string;
    challengeId: string;
  }): Promise<void>;
}

export type SignInStep = "phone" | "otp" | "linking" | "done";

export interface SignInState {
  step: SignInStep;
  phoneNumber: string;
  error: string | null;
  info: string | null;
  busy: boolean;
  /** Epoch ms when a resend becomes available, or null off the OTP step. */
  resendAvailableAt: number | null;
}

const INITIAL_STATE: SignInState = {
  step: "phone",
  phoneNumber: "",
  error: null,
  info: null,
  busy: false,
  resendAvailableAt: null,
};

function httpStatusOf(error: unknown): number | null {
  return error instanceof SignInApiError ? error.status : null;
}

/**
 * The member-auth API's explicit provider-outage response (503 with code
 * OTP_UNAVAILABLE). It is global — it reveals nothing about the phone
 * number or the challenge — so it is shown as what it is, unlike every
 * other verification failure, which stays generic.
 */
function isProviderUnavailable(error: unknown): boolean {
  return (
    error instanceof SignInApiError &&
    error.status === 503 &&
    error.code === "OTP_UNAVAILABLE"
  );
}

export class MemberSignInFlow {
  private organizationId: string;
  private readonly api: SignInApi;
  private readonly now: () => number;
  private readonly onProbe?: (organizationId: string) => void;

  private challengeId: string | null = null;
  private state: SignInState = { ...INITIAL_STATE };
  private readonly listeners = new Set<() => void>();
  // Incremented by reset(): in-flight calls from before a gym change
  // must not write their results into the new gym's flow.
  private generation = 0;

  constructor(deps: {
    organizationId: string;
    api: SignInApi;
    now?: () => number;
    onProbe?: (organizationId: string) => void;
  }) {
    this.organizationId = deps.organizationId;
    this.api = deps.api;
    this.now = deps.now ?? (() => Date.now());
    this.onProbe = deps.onProbe;
  }

  getState(): SignInState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  canResend(): boolean {
    return (
      this.state.step === "otp" &&
      !this.state.busy &&
      this.state.resendAvailableAt !== null &&
      this.now() >= this.state.resendAvailableAt
    );
  }

  async submitPhone(phoneNumber: string): Promise<void> {
    if (this.state.busy) return;
    const trimmed = phoneNumber.trim();
    if (!/^[0-9]{10}$/.test(trimmed)) {
      this.setState({
        phoneNumber: trimmed,
        error: PHONE_ERROR_COPY,
        info: null,
      });
      return;
    }
    const generation = this.generation;
    this.setState({ phoneNumber: trimmed, busy: true, error: null, info: null });
    try {
      const { challengeId } = await this.api.requestOtp({
        organizationId: this.organizationId,
        phoneNumber: trimmed,
      });
      if (generation !== this.generation) return;
      this.challengeId = challengeId;
      this.setState({
        step: "otp",
        info: OTP_REQUEST_INFO_COPY,
        error: null,
        resendAvailableAt: this.now() + OTP_RESEND_COOLDOWN_MS,
        busy: false,
      });
    } catch (error) {
      if (generation !== this.generation) return;
      const status = httpStatusOf(error);
      if (status === 503) {
        this.setState({ error: SMS_UNAVAILABLE_COPY, busy: false });
      } else if (status === 400) {
        this.setState({ error: PHONE_ERROR_COPY, busy: false });
      } else {
        this.setState({ error: CONNECTION_ERROR_COPY, busy: false });
      }
    }
  }

  async submitOtp(otp: string): Promise<void> {
    if (this.state.busy || this.state.step !== "otp" || !this.challengeId) {
      return;
    }
    const code = otp.trim();
    if (!/^[0-9]{6}$/.test(code)) {
      // Mirrors the server: a malformed code fails generically without
      // consuming an attempt — so it never reaches the API here either.
      this.setState({ error: OTP_FAILURE_COPY, info: null });
      return;
    }
    const challengeId = this.challengeId;
    const generation = this.generation;
    this.setState({ busy: true, error: null, info: null });

    try {
      await this.api.verifyOtp({
        organizationId: this.organizationId,
        challengeId,
        otp: code,
      });
    } catch (error) {
      if (generation !== this.generation) return;
      if (httpStatusOf(error) !== null) {
        // A definitive server answer. The explicit provider outage
        // (503 OTP_UNAVAILABLE) gets the SMS-unavailable message — it is
        // global and reveals nothing about eligibility or the challenge.
        // Every other definitive failure (wrong, expired, superseded, or
        // locked code) gets the one generic message.
        this.setState({
          error: isProviderUnavailable(error)
            ? SMS_UNAVAILABLE_COPY
            : OTP_FAILURE_COPY,
          busy: false,
        });
        return;
      }
      // No response arrived: the verification may still have succeeded
      // server-side. Fall through to the link attempt — link on an
      // unverified challenge fails harmlessly without consuming it, and
      // the probe resolves the truth either way.
    }
    if (generation !== this.generation) return;

    this.setState({ step: "linking" });
    try {
      await this.api.link({
        organizationId: this.organizationId,
        challengeId,
      });
    } catch {
      // Deliberately ignored: the link outcome — success, generic
      // failure, or a lost response — is indistinguishable from here
      // and equally likely to have set the session cookie. Never retry
      // a possibly-consumed challenge; the probe decides.
    }
    if (generation !== this.generation) return;
    this.challengeId = null;
    this.setState({ step: "done", busy: false });
    this.onProbe?.(this.organizationId);
  }

  async resend(): Promise<void> {
    if (!this.canResend()) return;
    const generation = this.generation;
    this.setState({ busy: true, error: null });
    try {
      const { challengeId } = await this.api.requestOtp({
        organizationId: this.organizationId,
        phoneNumber: this.state.phoneNumber,
      });
      if (generation !== this.generation) return;
      // The fresh challenge supersedes the old one server-side.
      this.challengeId = challengeId;
      this.setState({
        info: OTP_REQUEST_INFO_COPY,
        error: null,
        resendAvailableAt: this.now() + OTP_RESEND_COOLDOWN_MS,
        busy: false,
      });
    } catch (error) {
      if (generation !== this.generation) return;
      const status = httpStatusOf(error);
      if (status === 503) {
        this.setState({ error: SMS_UNAVAILABLE_COPY, busy: false });
      } else {
        this.setState({ error: CONNECTION_ERROR_COPY, busy: false });
      }
    }
  }

  backToPhone(): void {
    if (
      this.state.busy ||
      this.state.step === "linking" ||
      this.state.step === "done"
    ) {
      return;
    }
    this.challengeId = null;
    this.setState({
      step: "phone",
      error: null,
      info: null,
      resendAvailableAt: null,
    });
  }

  reset(organizationId: string): void {
    this.generation += 1;
    this.organizationId = organizationId;
    this.challengeId = null;
    this.state = { ...INITIAL_STATE };
    this.emit();
  }

  private setState(patch: Partial<SignInState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
