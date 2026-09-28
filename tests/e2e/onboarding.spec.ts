import { expect, test } from "@playwright/test";

// Organization / owner onboarding foundation: unauthenticated visitors must
// be redirected to sign-in before reaching onboarding or the organization's
// protected area. (Authenticated flows need a live Clerk instance and are
// covered by unit tests + CI against the real app.)
test("onboarding page redirects unauthenticated visitors to sign-in", async ({
  page,
}) => {
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByLabel("Gym name")).toHaveCount(0);
});

test("organization page redirects unauthenticated visitors to sign-in", async ({
  page,
}) => {
  await page.goto("/app/org");
  await expect(page).toHaveURL(/\/sign-in/);
});
