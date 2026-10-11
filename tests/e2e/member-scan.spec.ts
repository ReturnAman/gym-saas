import { expect, test } from "@playwright/test";

// In-app gym QR scan: a public discovery page (no member session is
// required — a signed-out member may scan first and the check-in
// landing then handles sign-in with the gym preserved). These tests
// never touch the camera: they pin the page shell, the scan affordance
// (a Start scanning button, or the unsupported message where the
// browser context has no usable camera API), and the manual fallback.
test("member scan page renders the scanner shell and the fallback", async ({
  page,
}) => {
  await page.goto("/member/scan");

  await expect(
    page.getByRole("heading", { name: "Scan gym QR" }),
  ).toBeVisible();

  const startButton = page.getByRole("button", { name: "Start scanning" });
  const unsupported = page.getByText("can't scan QR codes here");
  await expect(startButton.or(unsupported)).toBeVisible();

  const fallback = page.getByRole("link", {
    name: "Continue without scanning",
  });
  await expect(fallback).toBeVisible();
  await expect(fallback).toHaveAttribute("href", "/member/check-in");

  await expect(
    page.getByText("gym staff can check you in at the front desk"),
  ).toBeVisible();
});
