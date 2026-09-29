import { expect, test } from "@playwright/test";

// Gym profile/settings: unauthenticated visitors must be redirected to
// sign-in before reaching the settings page. Authenticated happy-path
// behavior (view/edit/save) needs a live Clerk instance and is covered by
// server-side unit tests + CI.
test("settings page redirects unauthenticated visitors to sign-in", async ({
  page,
}) => {
  await page.goto("/app/org/settings");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByLabel("Gym name")).toHaveCount(0);
});
