"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import { MEMBERSHIP_PLANS, PLAN_LABELS } from "@/lib/members";
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

  // Join-request details (join intent only).
  const [joinName, setJoinName] = useState("");
  const [joinPlan, setJoinPlan] = useState("");
  const [joinFee, setJoinFee] = useState("");
  const [joinStartDate, setJoinStartDate] = useState("");

  // Tick once a second on the OTP step so the resend countdown and the
  // button's enabled state stay current.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (state.step !== "otp") return;
    // Sync the tick state on entering the step: nowMs was initialized
    // when the form mounted (the phone step), so without this the
    // first countdown paint overstates the remaining time by however
    // long the member spent before the code was requested. The sync is
    // deferred to the next animation frame: setState synchronously in
    // an effect body is disallowed (react-hooks/set-state-in-effect),
    // and the frame callback runs before the following paint.
    const frame = requestAnimationFrame(() => setNowMs(Date.now()));
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(id);
    };
  }, [state.step]);

  if (state.step === "linking") {
    return <p>Signing you in…</p>;
  }
  if (state.step === "done") {
    if (state.joinOutcome) {
      // A join submission reached its outcome: there is no session
      // and nothing to redirect to — the message is the end state.
      return (
        <div>
          {state.info && <p>{state.info}</p>}
          {state.joinOutcome === "created" && (
            <p>
              The gym will review your request and confirm your
              membership details with you.
            </p>
          )}
          {state.joinOutcome === "already_registered" && (
            <p>
              <button
                type="button"
                onClick={() => {
                  setOtp("");
                  flow.reset(gymId);
                }}
              >
                Back to sign in
              </button>
            </p>
          )}
        </div>
      );
    }
    return <p>Redirecting…</p>;
  }

  if (state.step === "join-details") {
    const fieldErrors = state.joinFieldErrors;
    return (
      <div>
        <p>
          Your number is verified. Tell the gym who you are and the
          membership you would like — the gym confirms the final plan,
          fee, and dates before your membership becomes active.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void flow.submitJoinDetails({
              name: joinName,
              requestedPlan: joinPlan,
              proposedFee: joinFee,
              proposedStartDate: joinStartDate,
            });
          }}
        >
          <div>
            <label htmlFor="joinName">Your name</label>
            <input
              id="joinName"
              name="name"
              type="text"
              autoComplete="name"
              value={joinName}
              onChange={(event) => setJoinName(event.target.value)}
            />
            {fieldErrors.name && <p role="alert">{fieldErrors.name}</p>}
          </div>
          <div>
            <label htmlFor="joinPlan">Plan</label>
            <select
              id="joinPlan"
              name="requestedPlan"
              value={joinPlan}
              onChange={(event) => setJoinPlan(event.target.value)}
            >
              <option value="">Choose a plan</option>
              {MEMBERSHIP_PLANS.map((plan) => (
                <option key={plan} value={plan}>
                  {PLAN_LABELS[plan]}
                </option>
              ))}
            </select>
            {fieldErrors.plan && <p role="alert">{fieldErrors.plan}</p>}
          </div>
          <div>
            <label htmlFor="joinFee">Proposed fee (₹)</label>
            <input
              id="joinFee"
              name="proposedFee"
              type="text"
              inputMode="decimal"
              value={joinFee}
              onChange={(event) => setJoinFee(event.target.value)}
            />
            {fieldErrors.fee && <p role="alert">{fieldErrors.fee}</p>}
          </div>
          <div>
            <label htmlFor="joinStartDate">Proposed start date</label>
            <input
              id="joinStartDate"
              name="proposedStartDate"
              type="date"
              value={joinStartDate}
              onChange={(event) => setJoinStartDate(event.target.value)}
            />
            {fieldErrors.startDate && (
              <p role="alert">{fieldErrors.startDate}</p>
            )}
          </div>
          {state.error && <p role="alert">{state.error}</p>}
          <button type="submit" disabled={state.busy}>
            {state.busy ? "Please wait…" : "Send request"}
          </button>
        </form>
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
      </div>
    );
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
        <p>
          {state.intent === "join"
            ? "Enter your mobile number. We'll send a code to verify it, then you can send your join request to this gym."
            : "Enter the phone number registered with this gym."}
        </p>
        {state.error && <p role="alert">{state.error}</p>}
        <button type="submit" disabled={state.busy}>
          {state.busy ? "Please wait…" : "Continue"}
        </button>
      </form>
      {state.intent === "join" ? (
        <p>
          Already a member of this gym?{" "}
          <button type="button" onClick={() => flow.chooseSignIn()}>
            Sign in instead
          </button>
        </p>
      ) : (
        <p>
          New to this gym?{" "}
          <button type="button" onClick={() => flow.chooseJoin()}>
            Request to join
          </button>
        </p>
      )}
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
