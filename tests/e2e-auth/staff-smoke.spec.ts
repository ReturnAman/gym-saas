import { expect, test } from "@playwright/test";

import { E2E_GYM_NAME } from "./fixtures";

/**
 * The one authenticated smoke test (S3b-1): the OWNER session created
 * by the setup project opens staff management and sees the fixture
 * gym, the primary-gym limitation note, and their own OWNER row.
 * Runs with the saved OWNER storage state (see playwright.auth.config.ts).
 */
test("owner sees their gym, the primary-gym note, and their own staff row", async ({
  page,
}) => {
  await page.goto("/app/org/staff");

  await expect(
    page.getByRole("heading", { name: E2E_GYM_NAME }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "You are managing staff for your primary gym. Switching gyms is not available yet.",
    ),
  ).toBeVisible();

  // The staff list is a <ul> of rows inside the "Staff list" section
  // (there is no table in the rendered page — an earlier version of
  // this spec scoped its locators to a table that never existed).
  const staffList = page.locator("section[aria-label=\"Staff list\"]");
  await expect(staffList.getByText("(You)")).toBeVisible();
  await expect(staffList.getByText("Owner", { exact: true })).toBeVisible();
  // A fresh fixture gym has exactly one staff row: the owner.
  await expect(staffList.locator("li")).toHaveCount(1);
});
