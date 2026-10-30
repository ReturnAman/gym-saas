import { describe, expect, it } from "vitest";

import {
  TRIAL_OFFER_WINDOW_MS,
  isInOfferWindow,
  isOperationsState,
  resolveEffectiveState,
  trialRemainingMs,
  type SubscriptionWindow,
} from "../subscriptions";

/**
 * Effective-state resolver: the boundary rules the whole slice depends
 * on. A period is live only while now < endsAt — at the exact expiry
 * timestamp it is expired — and suspension overrides everything.
 */
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

function window(overrides: Partial<SubscriptionWindow> = {}): SubscriptionWindow {
  return { suspendedAt: null, paidThroughAt: null, trialEndsAt: null, ...overrides };
}

describe("resolveEffectiveState", () => {
  const now = new Date("2026-10-25T12:00:00.000Z");

  it("is PENDING_PAYMENT with no subscription row or no entitlement", () => {
    expect(resolveEffectiveState(null, now)).toBe("PENDING_PAYMENT");
    expect(resolveEffectiveState(window(), now)).toBe("PENDING_PAYMENT");
  });

  it("is TRIAL_ACTIVE immediately before expiry and EXPIRED at the exact expiry", () => {
    const endsAt = new Date("2026-10-25T12:00:00.000Z");
    expect(
      resolveEffectiveState(window({ trialEndsAt: endsAt }), new Date(endsAt.getTime() - 1)),
    ).toBe("TRIAL_ACTIVE");
    expect(resolveEffectiveState(window({ trialEndsAt: endsAt }), endsAt)).toBe(
      "EXPIRED",
    );
    expect(
      resolveEffectiveState(window({ trialEndsAt: endsAt }), new Date(endsAt.getTime() + 1)),
    ).toBe("EXPIRED");
  });

  it("is ACTIVE immediately before paid expiry and EXPIRED at the exact paid expiry", () => {
    const paidThrough = new Date("2026-11-01T00:00:00.000Z");
    expect(
      resolveEffectiveState(
        window({ paidThroughAt: paidThrough }),
        new Date(paidThrough.getTime() - 1),
      ),
    ).toBe("ACTIVE");
    expect(
      resolveEffectiveState(window({ paidThroughAt: paidThrough }), paidThrough),
    ).toBe("EXPIRED");
  });

  it("prefers a live paid period over a live trial, and a live trial over a lapsed paid period", () => {
    expect(
      resolveEffectiveState(
        window({
          trialEndsAt: new Date(now.getTime() + DAY),
          paidThroughAt: new Date(now.getTime() + 30 * DAY),
        }),
        now,
      ),
    ).toBe("ACTIVE");
    expect(
      resolveEffectiveState(
        window({
          trialEndsAt: new Date(now.getTime() + DAY),
          paidThroughAt: new Date(now.getTime() - DAY),
        }),
        now,
      ),
    ).toBe("TRIAL_ACTIVE");
  });

  it("treats suspension as an override of a live trial and a live paid period", () => {
    expect(
      resolveEffectiveState(
        window({
          suspendedAt: new Date(now.getTime() - HOUR),
          trialEndsAt: new Date(now.getTime() + DAY),
          paidThroughAt: new Date(now.getTime() + 30 * DAY),
        }),
        now,
      ),
    ).toBe("SUSPENDED");
  });

  it("allows operations only for TRIAL_ACTIVE and ACTIVE", () => {
    expect(isOperationsState("TRIAL_ACTIVE")).toBe(true);
    expect(isOperationsState("ACTIVE")).toBe(true);
    expect(isOperationsState("PENDING_PAYMENT")).toBe(false);
    expect(isOperationsState("EXPIRED")).toBe(false);
    expect(isOperationsState("SUSPENDED")).toBe(false);
  });
});

describe("trialRemainingMs and isInOfferWindow", () => {
  const now = new Date("2026-10-25T12:00:00.000Z");

  it("returns null remaining for no trial or an expired trial", () => {
    expect(trialRemainingMs(null, now)).toBeNull();
    expect(
      trialRemainingMs(window({ trialEndsAt: new Date(now.getTime() - 1) }), now),
    ).toBeNull();
  });

  it("opens the offer window at exactly 48 hours remaining and closes it at expiry", () => {
    const at48h = window({
      trialEndsAt: new Date(now.getTime() + TRIAL_OFFER_WINDOW_MS),
    });
    expect(isInOfferWindow(at48h, now)).toBe(true);
    const over48h = window({
      trialEndsAt: new Date(now.getTime() + TRIAL_OFFER_WINDOW_MS + 1),
    });
    expect(isInOfferWindow(over48h, now)).toBe(false);
    const expired = window({
      trialEndsAt: new Date(now.getTime() - 1),
    });
    expect(isInOfferWindow(expired, now)).toBe(false);
  });

  it("never opens the offer window for a paid-only gym", () => {
    expect(
      isInOfferWindow(
        window({ paidThroughAt: new Date(now.getTime() + HOUR) }),
        now,
      ),
    ).toBe(false);
  });

  it("never opens the offer window for a suspended gym, even inside the final 48 hours", () => {
    expect(
      isInOfferWindow(
        window({
          trialEndsAt: new Date(now.getTime() + 24 * HOUR),
          suspendedAt: now,
        }),
        now,
      ),
    ).toBe(false);
  });
});
