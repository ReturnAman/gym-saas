"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import {
  MemberSignInFlow,
  type SignInState,
} from "@/lib/member-sign-in-flow";

import { memberSignInApi } from "./sign-in-api";

/**
 * Member sign-in form — a thin renderer over MemberSignInFlow
 * (src/lib/member-sign-in-flow.ts), which owns all behavior: phone and
 * code validation, the resend cooldown, generic error copy, duplicate
 * submission protection, and the verify → link → probe hand-off. This
 * component only reflects the flow's state and forwards input.
 *
 * The flow is gym-scoped: the page remounts this form per gym (React
 * key), and the effect below resets the flow if an instance is ever
 * reused for a different gym, so no challenge can leak across gyms.
 * When the flow finishes it probes — navigates to the check-in landing
 * for this gym, which renders from the actual session.
 */
export function SignInForm({ gymId }: { gymId: string }) {
  const router = useRouter();

  // The flow is created once per component instance (lazy state
  // initializer) and lives for the life of the form.
  const [flow] = useState(
    () =>
      new MemberSignInFlow({
        organizationId: gymId,
        api: memberSignInApi,
        onProbe: (organizationId) => {
          router.push(`/member/check-in?gym=${organizationId}`);
        },
      }),
  );

  // Belt and braces alongside the page's per-gym remount (React key):
  // if an instance is ever reused for a different gym, reset the flow
  // so no challenge or input leaks across gyms.
  const [instanceGym] = useState(gymId);
  useEffect(() => {
    if (instanceGym !== gymId) {
      flow.reset(gymId);
    }
  }, [gymId, instanceGym, flow]);

  const state = useSyncExternalStore<SignInState>(
    (onStoreChange) => flow.subscribe(onStoreChange),
    () => flow.getState(),
    () => flow.getState(),
  );

  // Input values live here (not per step) so the phone number survives
  // "Wrong number? Go back" for editing.
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");

  // Tick once a second on the OTP step so the resend countdown and the
  // button's enabled state stay current.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (state.step !== "otp") return;
    // Sync the tick state on entering the step: nowMs was initialized
    // when the form mounted (the phone step), so without this the
    // first countdown paint overstates the remaining time by however
    // long the member spent before the code was requested.
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state.step]);

  if (state.step === "linking") {
    return <p>Signing you in…</p>;
  }
  if (state.step === "done") {
    return <p>Redirecting…</p>;
  }

  if (state.step === "otp") {
    const resendInMs =
      state.resendAvailableAt === null
        ? 0
        : Math.max(0, state.resendAvailableAt - nowMs);
    const canResend = flow.canResend();
    return (
      <div>
        {state.info && <p>{state.info}</p>}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void flow.submitOtp(otp);
          }}
        >
          <div>
            <label htmlFor="otp">6-digit code</label>
            <input
              id="otp"
              name="otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otp}
              onChange={(event) => setOtp(event.target.value)}
            />
          </div>
          {state.error && <p role="alert">{state.error}</p>}
          <button type="submit" disabled={state.busy}>
            {state.busy ? "Please wait…" : "Verify"}
          </button>
        </form>
        <p>
          <button
            type="button"
            disabled={!canResend}
            onClick={() => {
              setOtp("");
              void flow.resend();
            }}
          >
            {canResend
              ? "Request a new code"
              : `Request a new code in ${formatCountdown(resendInMs)}`}
          </button>
        </p>
        <p>
          <button
            type="button"
            onClick={() => {
              setOtp("");
              flow.backToPhone();
            }}
          >
            Wrong number? Go back
          </button>
        </p>
        <p>If your phone number has changed, please see the front desk.</p>
      </div>
    );
  }

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void flow.submitPhone(phone);
        }}
      >
        <div>
          <label htmlFor="phoneNumber">Mobile number</label>
          <input
            id="phoneNumber"
            name="phoneNumber"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            maxLength={10}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </div>
        <p>Enter the phone number registered with this gym.</p>
        {state.error && <p role="alert">{state.error}</p>}
        <button type="submit" disabled={state.busy}>
          {state.busy ? "Please wait…" : "Continue"}
        </button>
      </form>
      <p>If your phone number has changed, please see the front desk.</p>
    </>
  );
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
