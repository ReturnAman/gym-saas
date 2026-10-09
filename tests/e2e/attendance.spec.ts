import { expect, test } from "@playwright/test";

// Attendance route: unauthenticated visitors must be redirected to
// sign-in before reaching it. Authenticated behavior (today's sessions,
// check-in/out, expired-membership confirmation) needs a live Clerk
// instance and database, and is covered by server-side unit tests + CI.
test("gym attendance page redirects unauthenticated visitors to sign-in", async ({
  page,
}) => {
  await page.goto("/app/org/attendance");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByText("No check-ins yet today.")).toHaveCount(0);
});
