import { expect, test } from "@playwright/test";

// Member management routes: unauthenticated visitors must be redirected to
// sign-in before reaching any of them. Authenticated happy-path behavior
// (list/add/details/edit, validation, duplicate surfacing) needs a live
// Clerk instance and database, and is covered by server-side unit tests + CI.
test("members list redirects unauthenticated visitors to sign-in", async ({
  page,
}) => {
  await page.goto("/app/org/members");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("add member page redirects unauthenticated visitors to sign-in", async ({
  page,
}) => {
  await page.goto("/app/org/members/new");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByLabel("Phone number")).toHaveCount(0);
});

test("member details redirects unauthenticated visitors to sign-in", async ({
  page,
}) => {
  await page.goto("/app/org/members/some-member-id");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("edit member page redirects unauthenticated visitors to sign-in", async ({
  page,
}) => {
  await page.goto("/app/org/members/some-member-id/edit");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("record payment page redirects unauthenticated visitors to sign-in", async ({
  page,
}) => {
  await page.goto("/app/org/members/some-member-id/payments/new");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByLabel("Amount received (₹)")).toHaveCount(0);
});
