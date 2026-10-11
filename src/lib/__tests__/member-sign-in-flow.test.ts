import { describe, expect, it, vi } from "vitest";

import {
  CONNECTION_ERROR_COPY,
  MemberSignInFlow,
  OTP_FAILURE_COPY,
  OTP_REQUEST_INFO_COPY,
  OTP_RESEND_COOLDOWN_MS,
  PHONE_ERROR_COPY,
  SMS_UNAVAILABLE_COPY,
  SignInApiError,
  type SignInApi,
} from "../member-sign-in-flow";

const GYM_A = "11111111-1111-4111-8111-111111111111";
const GYM_B = "22222222-2222-4222-8222-222222222222";
const PHONE = "9876543210";

type RequestInput = { organizationId: string; phoneNumber: string };
type VerifyInput = { organizationId: string; challengeId: string; otp: string };
type LinkInput = { organizationId: string; challengeId: string };

/** Call-counting fake API with programmable per-call behavior. */
class FakeSignInApi implements SignInApi {
  requestCalls: RequestInput[] = [];
  verifyCalls: VerifyInput[] = [];
  linkCalls: LinkInput[] = [];

  requestHandler: (input: RequestInput) => Promise<{ challengeId: string }> =
    async () => ({ challengeId: `challenge-${this.requestCalls.length}` });
  verifyHandler: (input: VerifyInput) => Promise<void> = async () => {};
  linkHandler: (input: LinkInput) => Promise<void> = async () => {};

  async requestOtp(input: RequestInput) {
    this.requestCalls.push(input);
    return this.requestHandler(input);
  }
  async verifyOtp(input: VerifyInput) {
    this.verifyCalls.push(input);
    return this.verifyHandler(input);
  }
  async link(input: LinkInput) {
    this.linkCalls.push(input);
    return this.linkHandler(input);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeFlow() {
  const api = new FakeSignInApi();
  let nowMs = 1_700_000_000_000;
  const probes: string[] = [];
  const flow = new MemberSignInFlow({
    organizationId: GYM_A,
    api,
    now: () => nowMs,
    onProbe: (organizationId) => probes.push(organizationId),
  });
  return {
    api,
    flow,
    probes,
    now: () => nowMs,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

/** Drive a flow to the OTP step with the default fake API. */
async function toOtpStep(flow: MemberSignInFlow) {
  await flow.submitPhone(PHONE);
  expect(flow.getState().step).toBe("otp");
}

describe("MemberSignInFlow — phone step", () => {
  it("rejects malformed phone numbers without calling the API", async () => {
    const { api, flow } = makeFlow();
    for (const bad of ["", "123", "98765abcde", "98765 43210", "98765432109"]) {
      await flow.submitPhone(bad);
      expect(flow.getState().step).toBe("phone");
      expect(flow.getState().error).toBe(PHONE_ERROR_COPY);
    }
    expect(api.requestCalls).toHaveLength(0);
  });

  it("trims surrounding whitespace before validating", async () => {
    const { api, flow } = makeFlow();
    await flow.submitPhone(`  ${PHONE}  `);
    expect(api.requestCalls).toEqual([
      { organizationId: GYM_A, phoneNumber: PHONE },
    ]);
    expect(flow.getState().step).toBe("otp");
  });

  it("moves to the OTP step with neutral copy and a full cooldown on success", async () => {
    const { flow, now } = makeFlow();
    await flow.submitPhone(PHONE);
    const state = flow.getState();
    expect(state.step).toBe("otp");
    expect(state.info).toBe(OTP_REQUEST_INFO_COPY);
    expect(state.error).toBeNull();
    expect(state.busy).toBe(false);
    expect(state.resendAvailableAt).toBe(now() + OTP_RESEND_COOLDOWN_MS);
    expect(flow.canResend()).toBe(false);
    // The challenge id is never part of the renderable state.
    expect(JSON.stringify(state)).not.toContain("challenge-");
  });

  it("maps a 503 (provider unavailable) to the SMS-unavailable copy and stays", async () => {
    const { api, flow } = makeFlow();
    api.requestHandler = async () => {
      throw new SignInApiError(503, "OTP_UNAVAILABLE");
    };
    await flow.submitPhone(PHONE);
    expect(flow.getState().step).toBe("phone");
    expect(flow.getState().error).toBe(SMS_UNAVAILABLE_COPY);
    expect(flow.getState().busy).toBe(false);
  });

  it("maps a 400 to the phone-error copy", async () => {
    const { api, flow } = makeFlow();
    api.requestHandler = async () => {
      throw new SignInApiError(400, "VALIDATION_ERROR");
    };
    await flow.submitPhone(PHONE);
    expect(flow.getState().error).toBe(PHONE_ERROR_COPY);
    expect(flow.getState().step).toBe("phone");
  });

  it("maps network failure and other statuses to the connection copy", async () => {
    const { api, flow } = makeFlow();
    api.requestHandler = async () => {
      throw new SignInApiError(null, null);
    };
    await flow.submitPhone(PHONE);
    expect(flow.getState().error).toBe(CONNECTION_ERROR_COPY);

    api.requestHandler = async () => {
      throw new SignInApiError(500, "INTERNAL_ERROR");
    };
    await flow.submitPhone(PHONE);
    expect(flow.getState().error).toBe(CONNECTION_ERROR_COPY);
    expect(flow.getState().step).toBe("phone");
  });

  it("ignores a duplicate submission while a request is in flight", async () => {
    const { api, flow } = makeFlow();
    const gate = deferred<{ challengeId: string }>();
    api.requestHandler = () => gate.promise;
    const first = flow.submitPhone(PHONE);
    const second = flow.submitPhone(PHONE);
    gate.resolve({ challengeId: "challenge-1" });
    await Promise.all([first, second]);
    expect(api.requestCalls).toHaveLength(1);
    expect(flow.getState().step).toBe("otp");
  });
});

describe("MemberSignInFlow — OTP step and linking", () => {
  it("fails malformed codes generically without calling the API", async () => {
    const { api, flow } = makeFlow();
    await toOtpStep(flow);
    for (const bad of ["", "12345", "abcdef", "1234567"]) {
      await flow.submitOtp(bad);
      expect(flow.getState().error).toBe(OTP_FAILURE_COPY);
      expect(flow.getState().step).toBe("otp");
    }
    expect(api.verifyCalls).toHaveLength(0);
  });

  it("keeps the same challenge after an HTTP verify failure and allows retry", async () => {
    const { api, flow, probes } = makeFlow();
    await toOtpStep(flow);
    api.verifyHandler = async () => {
      throw new SignInApiError(400, "INVALID_OR_EXPIRED_CODE");
    };
    await flow.submitOtp("000000");
    expect(flow.getState().step).toBe("otp");
    expect(flow.getState().error).toBe(OTP_FAILURE_COPY);
    expect(flow.getState().busy).toBe(false);
    expect(api.linkCalls).toHaveLength(0);
    expect(probes).toHaveLength(0);

    api.verifyHandler = async () => {};
    await flow.submitOtp("123456");
    expect(api.verifyCalls).toEqual([
      { organizationId: GYM_A, challengeId: "challenge-1", otp: "000000" },
      { organizationId: GYM_A, challengeId: "challenge-1", otp: "123456" },
    ]);
    expect(flow.getState().step).toBe("done");
  });

  it("shows the SMS-unavailable message for an explicit provider outage on verify, keeping the challenge", async () => {
    const { api, flow, probes } = makeFlow();
    await toOtpStep(flow);
    api.verifyHandler = async () => {
      throw new SignInApiError(503, "OTP_UNAVAILABLE");
    };
    await flow.submitOtp("123456");
    expect(flow.getState().error).toBe(SMS_UNAVAILABLE_COPY);
    expect(flow.getState().step).toBe("otp");
    expect(flow.getState().busy).toBe(false);
    expect(api.linkCalls).toHaveLength(0);
    expect(probes).toHaveLength(0);

    // The challenge is retained: once the provider recovers, the same
    // challenge verifies and the flow proceeds to link + probe.
    api.verifyHandler = async () => {};
    await flow.submitOtp("123456");
    expect(api.verifyCalls).toEqual([
      { organizationId: GYM_A, challengeId: "challenge-1", otp: "123456" },
      { organizationId: GYM_A, challengeId: "challenge-1", otp: "123456" },
    ]);
    expect(flow.getState().step).toBe("done");
    expect(probes).toEqual([GYM_A]);
  });

  it("keeps any other HTTP verify failure generic — including a 503 without the outage code", async () => {
    const { api, flow } = makeFlow();
    await toOtpStep(flow);
    api.verifyHandler = async () => {
      throw new SignInApiError(503, "UNEXPECTED");
    };
    await flow.submitOtp("123456");
    expect(flow.getState().error).toBe(OTP_FAILURE_COPY);
    expect(flow.getState().step).toBe("otp");
    expect(api.linkCalls).toHaveLength(0);
  });

  it("links exactly once after a successful verify, then probes", async () => {
    const { api, flow, probes } = makeFlow();
    await toOtpStep(flow);
    await flow.submitOtp("123456");
    expect(api.linkCalls).toEqual([
      { organizationId: GYM_A, challengeId: "challenge-1" },
    ]);
    expect(flow.getState().step).toBe("done");
    expect(flow.getState().busy).toBe(false);
    expect(probes).toEqual([GYM_A]);
  });

  it("probes even when link fails with an HTTP error — never retries link", async () => {
    const { api, flow, probes } = makeFlow();
    await toOtpStep(flow);
    api.linkHandler = async () => {
      throw new SignInApiError(400, "LINK_FAILED");
    };
    await flow.submitOtp("123456");
    expect(api.linkCalls).toHaveLength(1);
    expect(flow.getState().step).toBe("done");
    expect(probes).toEqual([GYM_A]);
  });

  it("probes even when the link response is lost (network failure)", async () => {
    const { api, flow, probes } = makeFlow();
    await toOtpStep(flow);
    api.linkHandler = async () => {
      throw new SignInApiError(null, null);
    };
    await flow.submitOtp("123456");
    expect(api.linkCalls).toHaveLength(1);
    expect(flow.getState().step).toBe("done");
    expect(probes).toEqual([GYM_A]);
  });

  it("proceeds to link + probe when the verify response is lost", async () => {
    const { api, flow, probes } = makeFlow();
    await toOtpStep(flow);
    api.verifyHandler = async () => {
      throw new SignInApiError(null, null);
    };
    await flow.submitOtp("123456");
    // The verify may have succeeded server-side; the link attempt is
    // harmless if it did not, and the probe resolves the truth.
    expect(api.linkCalls).toEqual([
      { organizationId: GYM_A, challengeId: "challenge-1" },
    ]);
    expect(flow.getState().step).toBe("done");
    expect(probes).toEqual([GYM_A]);
  });

  it("ignores a duplicate OTP submission while verification is in flight", async () => {
    const { api, flow } = makeFlow();
    await toOtpStep(flow);
    const gate = deferred<void>();
    api.verifyHandler = () => gate.promise;
    const first = flow.submitOtp("123456");
    const second = flow.submitOtp("123456");
    gate.resolve();
    await Promise.all([first, second]);
    expect(api.verifyCalls).toHaveLength(1);
    expect(api.linkCalls).toHaveLength(1);
  });

  it("is a no-op when an OTP is submitted on the phone step", async () => {
    const { api, flow } = makeFlow();
    await flow.submitOtp("123456");
    expect(api.verifyCalls).toHaveLength(0);
    expect(flow.getState().step).toBe("phone");
  });

  it("notifies subscribers on state changes and honors unsubscribe", async () => {
    const { flow } = makeFlow();
    const listener = vi.fn();
    const unsubscribe = flow.subscribe(listener);
    await flow.submitPhone(PHONE);
    expect(listener).toHaveBeenCalled();
    const calls = listener.mock.calls.length;
    unsubscribe();
    flow.backToPhone();
    expect(listener.mock.calls.length).toBe(calls);
  });
});

describe("MemberSignInFlow — resend and cooldown", () => {
  it("is a no-op before the cooldown elapses", async () => {
    const { api, flow, advance } = makeFlow();
    await toOtpStep(flow);
    expect(flow.canResend()).toBe(false);
    await flow.resend();
    expect(api.requestCalls).toHaveLength(1);

    advance(OTP_RESEND_COOLDOWN_MS - 1);
    expect(flow.canResend()).toBe(false);
    await flow.resend();
    expect(api.requestCalls).toHaveLength(1);
  });

  it("replaces the challenge and restarts the cooldown at the boundary", async () => {
    const { api, flow, advance, now } = makeFlow();
    await toOtpStep(flow);
    advance(OTP_RESEND_COOLDOWN_MS);
    expect(flow.canResend()).toBe(true);

    await flow.resend();
    expect(api.requestCalls).toEqual([
      { organizationId: GYM_A, phoneNumber: PHONE },
      { organizationId: GYM_A, phoneNumber: PHONE },
    ]);
    expect(flow.getState().info).toBe(OTP_REQUEST_INFO_COPY);
    expect(flow.getState().error).toBeNull();
    expect(flow.getState().resendAvailableAt).toBe(
      now() + OTP_RESEND_COOLDOWN_MS,
    );
    expect(flow.canResend()).toBe(false);

    // The next verification uses the NEW challenge, not the old one.
    await flow.submitOtp("123456");
    expect(api.verifyCalls).toEqual([
      { organizationId: GYM_A, challengeId: "challenge-2", otp: "123456" },
    ]);
  });

  it("keeps the cooldown unchanged when a resend hits a provider outage", async () => {
    const { api, flow, advance } = makeFlow();
    await toOtpStep(flow);
    const availableAt = flow.getState().resendAvailableAt;
    advance(OTP_RESEND_COOLDOWN_MS);
    api.requestHandler = async () => {
      throw new SignInApiError(503, "OTP_UNAVAILABLE");
    };
    await flow.resend();
    expect(flow.getState().error).toBe(SMS_UNAVAILABLE_COPY);
    expect(flow.getState().busy).toBe(false);
    expect(flow.getState().resendAvailableAt).toBe(availableAt);
    expect(flow.canResend()).toBe(true);

    // The old challenge is still the live one after a failed resend.
    api.verifyHandler = async () => {};
    await flow.submitOtp("123456");
    expect(api.verifyCalls[0]?.challengeId).toBe("challenge-1");
  });

  it("keeps the cooldown unchanged on a network-failed resend", async () => {
    const { api, flow, advance } = makeFlow();
    await toOtpStep(flow);
    const availableAt = flow.getState().resendAvailableAt;
    advance(OTP_RESEND_COOLDOWN_MS);
    api.requestHandler = async () => {
      throw new SignInApiError(null, null);
    };
    await flow.resend();
    expect(flow.getState().error).toBe(CONNECTION_ERROR_COPY);
    expect(flow.getState().resendAvailableAt).toBe(availableAt);
  });
});

describe("MemberSignInFlow — back and reset", () => {
  it("backToPhone clears the challenge; a fresh phone submit starts over", async () => {
    const { api, flow } = makeFlow();
    await toOtpStep(flow);
    flow.backToPhone();
    const state = flow.getState();
    expect(state.step).toBe("phone");
    expect(state.error).toBeNull();
    expect(state.info).toBeNull();
    expect(state.resendAvailableAt).toBeNull();
    // The entered number is kept for editing.
    expect(state.phoneNumber).toBe(PHONE);

    await flow.submitPhone(PHONE);
    await flow.submitOtp("123456");
    // Second request produced challenge-2; verification must use it,
    // never the discarded challenge-1.
    expect(api.verifyCalls).toEqual([
      { organizationId: GYM_A, challengeId: "challenge-2", otp: "123456" },
    ]);
  });

  it("backToPhone is a no-op while a request is in flight", async () => {
    const { api, flow } = makeFlow();
    const gate = deferred<{ challengeId: string }>();
    api.requestHandler = () => gate.promise;
    const pending = flow.submitPhone(PHONE);
    flow.backToPhone();
    expect(flow.getState().busy).toBe(true);
    expect(flow.getState().step).toBe("phone");
    gate.resolve({ challengeId: "challenge-1" });
    await pending;
    expect(flow.getState().step).toBe("otp");
  });

  it("reset returns a pristine flow scoped to the new gym", async () => {
    const { api, flow } = makeFlow();
    await toOtpStep(flow);
    flow.reset(GYM_B);
    expect(flow.getState()).toEqual({
      step: "phone",
      phoneNumber: "",
      error: null,
      info: null,
      busy: false,
      resendAvailableAt: null,
    });
    expect(flow.canResend()).toBe(false);

    await flow.submitPhone(PHONE);
    await flow.submitOtp("123456");
    expect(api.requestCalls.at(-1)).toEqual({
      organizationId: GYM_B,
      phoneNumber: PHONE,
    });
    expect(api.verifyCalls.at(-1)?.organizationId).toBe(GYM_B);
    expect(api.linkCalls.at(-1)?.organizationId).toBe(GYM_B);
  });
});
