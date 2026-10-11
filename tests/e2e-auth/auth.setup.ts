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
 *    also creates the OWNER membership. On a fresh disposable database
 *    the form is always shown; when re-running locally against a
 *    reused database the fixture gym already exists and the form is
 *    absent, which is accepted.
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
  const gymNameField = page.getByLabel("Gym name");
  if (await gymNameField.isVisible().catch(() => false)) {
    await gymNameField.fill(E2E_GYM_NAME);
    await page.getByRole("button", { name: "Create gym" }).click();
    await page.waitForURL(/\/app(\/|$)/);
  }

  // Prove the whole chain before saving state: the staff page renders
  // under the fixture gym for this session.
  await page.goto("/app/org/staff");
  await expect(
    page.getByRole("heading", { name: E2E_GYM_NAME }),
  ).toBeVisible();

  await page.context().storageState({ path: OWNER_STORAGE_STATE });
});
