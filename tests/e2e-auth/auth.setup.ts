import { expect, test as setup } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";

import {
  E2E_GYM_NAME,
  OWNER_STORAGE_STATE,
  requireOwnerEmail,
} from "./fixtures";

/**
 * Authenticated harness setup (project "auth-setup"):
 *
 * 1. The Clerk testing token is initialized beforehand by the
 *    Playwright global setup (tests/e2e-auth/global.setup.ts), which
 *    is the lifecycle @clerk/testing is built for: clerkSetup() stores
 *    the token in process.env, and only the runner's main process can
 *    share that with every worker.
 * 2. The OWNER signs in through Clerk's real sign-in flow using the
 *    email_code strategy against a test-mode user (handled by
 *    @clerk/testing; no password or code is stored in the repo). The
 *    first sign-in synchronizes the local User row through the app's
 *    normal authenticated-request path.
 * 3. The OWNER's gym is created through the real onboarding UI, which
 *    also creates the OWNER membership. The setup waits for either
 *    the form (fresh disposable database) or the redirect to /app/org
 *    (re-running locally against a reused database that already has
 *    the fixture gym) — see the state detection in the test.
 * 4. The signed-in storage state is saved for the smoke project. It
 *    lives under tests/e2e-auth/.auth/ (gitignored) and is only valid
 *    for this disposable run.
 */

setup("authenticate as OWNER and create the gym", async ({ page }) => {
  // A public page that loads Clerk (required before clerk.signIn).
  await page.goto("/");
  await clerk.signIn({
    page,
    signInParams: {
      strategy: "email_code",
      identifier: requireOwnerEmail(),
    },
  });

  await page.goto("/onboarding");

  // Onboarding state detection. This is the first top-level
  // navigation after sign-in, and on a Clerk development instance it
  // can bounce through the session handshake — including a
  // client-side redirect after the initial document loads — before
  // the real page settles, so sampling visibility once is unreliable
  // (that is how the first CI run failed: the form was not yet the
  // rendered page, the check read "absent" as "already onboarded",
  // and no gym was ever created). Wait for one of the two legitimate
  // end states:
  //   "form"      — the onboarding form is shown (fresh fixture user)
  //   "onboarded" — the URL settles under /app/org (the page
  //                 redirects there when a membership already exists)
  // Anything else within the timeout is a harness failure, reported
  // with the current URL — never treated as onboarding complete.
  const gymNameField = page.getByLabel("Gym name");
  const STATE_TIMEOUT_MS = 30_000;
  const settled = await Promise.race([
    gymNameField
      .waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS })
      .then(() => "form" as const),
    page
      .waitForURL(/\/app\/org(\/|$)/, { timeout: STATE_TIMEOUT_MS })
      .then(() => "onboarded" as const),
  ]).catch(() => null);

  if (settled === null) {
    throw new Error(
      `Onboarding state never settled after sign-in: neither the gym ` +
        `creation form nor a redirect to /app/org occurred within ` +
        `${STATE_TIMEOUT_MS / 1000}s. Current URL: ${page.url()}`,
    );
  }

  if (settled === "form") {
    await gymNameField.fill(E2E_GYM_NAME);
    await page.getByRole("button", { name: "Create gym" }).click();
    await page.waitForURL(/\/app(\/|$)/);
  }

  // Prove the whole chain before saving state: the staff page renders
  // under the fixture gym for this session. The first protected
  // navigation can bounce through the handshake once more, so this
  // assertion gets a longer window than the default.
  await page.goto("/app/org/staff");
  await expect(
    page.getByRole("heading", { name: E2E_GYM_NAME }),
  ).toBeVisible({ timeout: 15_000 });

  await page.context().storageState({ path: OWNER_STORAGE_STATE });
});
