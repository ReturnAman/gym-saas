import { expect, test } from "@playwright/test";

// Foundation smoke tests: prove the browser/E2E infrastructure works
// against the development application. Product E2E tests come later.

test("home page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /one platform/i })).toBeVisible();
});

test("health endpoint reports ok", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toMatchObject({ status: "ok" });
});
