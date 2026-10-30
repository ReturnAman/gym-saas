/**
 * Shared fixtures for the authenticated E2E harness.
 *
 * The OWNER is a test-mode user on the dedicated Clerk development
 * instance (an email address in Clerk's documented test format, e.g.
 * name+clerk_test@example.com). Its address is configuration, not a
 * credential committed to the repo: it is read from the environment
 * (locally) or from the e2e-auth job's secrets (CI). No password or
 * verification code appears here — Clerk's test mode and the
 * @clerk/testing helpers handle sign-in.
 */

/** Name of the gym the setup creates for the OWNER through onboarding. */
export const E2E_GYM_NAME = "E2E Fixture Gym";

/** Playwright storage state for the signed-in OWNER (gitignored). */
export const OWNER_STORAGE_STATE = "tests/e2e-auth/.auth/owner.json";

export function requireOwnerEmail(): string {
  const email = process.env.CLERK_E2E_OWNER_EMAIL;
  if (!email) {
    throw new Error(
      "CLERK_E2E_OWNER_EMAIL is not set. The authenticated E2E harness " +
        "needs the test-mode OWNER's email address (see playwright.auth.config.ts).",
    );
  }
  return email;
}

/**
 * The OWNER fixture's 10-digit Indian mobile number, exactly as typed
 * into the onboarding field (no +91 — the field displays it). It MUST
 * match a number Clerk reports as verified on the fixture account, or
 * onboarding creates the gym in PENDING_PAYMENT and the staff-page
 * proof in auth.setup fails: the trial is granted only for the entered
 * number when it matches a verified number.
 */
export function requireOwnerPhone(): string {
  const phone = process.env.CLERK_E2E_OWNER_PHONE;
  if (!phone) {
    throw new Error(
      "CLERK_E2E_OWNER_PHONE is not set. The authenticated E2E harness " +
        "needs the test-mode OWNER's 10-digit mobile number, matching a " +
        "verified number on its Clerk account (see playwright.auth.config.ts).",
    );
  }
  return phone;
}
