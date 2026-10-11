import { expect, test } from "@playwright/test";

// Member attendance history: guarded by requireMemberContext, so a
// signed-out visitor is redirected to the member landing page, which
// renders its generic signed-out state — no attendance data is ever
// shown without a verified member session. Authenticated rendering
// needs a live member session and database, and is covered by the
// service, landing-state, and page-integrity unit tests.
test("member attendance page redirects signed-out visitors to the member landing", async ({
  page,
}) => {
  await page.goto("/member/attendance");
  await expect(page).toHaveURL(/\/member$/);
  await expect(page.getByText("No active member session.")).toBeVisible();
});
