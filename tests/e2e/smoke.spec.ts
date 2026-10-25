import { expect, test } from "@playwright/test";

// Foundation smoke tests: prove the browser/E2E infrastructure works
// against the development application. Product E2E tests come later.

test("home page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /one platform/i })).toBeVisible();
});

test("PWA app entry offers the correct signed-out paths", async ({ page }) => {
  await page.goto("/open");
  await expect(page.getByRole("heading", { name: /where would you like to go/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /gym owner or staff/i })).toHaveAttribute("href", "/sign-in");
  await expect(page.getByRole("link", { name: /i.m a member/i })).toHaveAttribute("href", "/member/scan");
});

test("PWA manifest opens into role-aware app entry", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toMatchObject({
    start_url: "/open",
    display: "standalone",
    theme_color: "#050505",
  });
});

test("health endpoint reports ok", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toMatchObject({ status: "ok" });
});
