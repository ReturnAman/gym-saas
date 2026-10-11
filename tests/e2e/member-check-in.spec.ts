import { expect, test } from "@playwright/test";

// Member check-in landing: a public page (no Clerk redirect) whose
// states are resolved from the member session cookie. A signed-out
// visitor scanning a gym QR code must land on the sign-in prompt for
// that flow — authenticated states (ready / checked-in / mismatch)
// need a live member session and database, and are covered by the
// server-side landing-state and route unit tests.
test("member check-in page shows the sign-in prompt to signed-out visitors", async ({
  page,
}) => {
  const response = await page.goto(
    "/member/check-in?gym=00000000-0000-4000-8000-000000000000",
  );
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Member check-in" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
});

test("member check-in page without a gym parameter renders without error", async ({
  page,
}) => {
  const response = await page.goto("/member/check-in");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Member check-in" }),
  ).toBeVisible();
});
