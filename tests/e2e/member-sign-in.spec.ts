import { expect, test, type Page, type Route } from "@playwright/test";

// Member sign-in UI: the phone → OTP → link flow driven against
// page.route-intercepted member-auth endpoints — no backend, database,
// or SMS provider involved. These tests pin the browser-level wiring
// (the flow state machine itself is unit-tested in
// src/lib/__tests__/member-sign-in-flow.test.ts): cooldown rendering,
// generic OTP failure copy, verify → link → probe progression, no
// blind link retry, and duplicate-submission protection.

const GYM_ID = "00000000-0000-4000-8000-000000000000";
const SIGN_IN_URL = `/member/sign-in?gym=${GYM_ID}`;
const CHECK_IN_URL = `/member/check-in?gym=${GYM_ID}`;
const PHONE = "9876543210";

const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

/** Intercept the OTP request endpoint with an immediate 200. */
async function mockRequestOk(page: Page, calls: string[]) {
  await page.route("**/api/member-auth/otp/request", async (route) => {
    calls.push("request");
    await fulfillJson(route, 200, { challengeId: "challenge-e2e" });
  });
}

test("resend is disabled with a countdown during the cooldown, then enables", async ({
  page,
}) => {
  await page.clock.install();
  const calls: string[] = [];
  await mockRequestOk(page, calls);
  await page.route("**/api/member-auth/otp/verify", async (route) => {
    calls.push("verify");
    await fulfillJson(route, 200, { verified: true });
  });

  await page.goto(SIGN_IN_URL);
  // The standing recovery hint is rendered on the phone step too,
  // regardless of any request outcome.
  await expect(
    page.getByText("If your phone number has changed, please see the front desk."),
  ).toBeVisible();
  await page.getByLabel("Mobile number").fill(PHONE);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(
    page.getByText("If this number is eligible, a code will arrive shortly."),
  ).toBeVisible();
  await expect(
    page.getByText("If your phone number has changed, please see the front desk."),
  ).toBeVisible();
  const resend = page.getByRole("button", { name: /Request a new code/ });
  await expect(resend).toBeDisabled();
  await expect(resend).toHaveText(/Request a new code in 0:30/);

  await page.clock.fastForward(31_000);
  await expect(resend).toBeEnabled();
  await expect(resend).toHaveText(/^Request a new code$/);
  expect(calls).toEqual(["request"]);
});

test("a failed verification shows the generic copy and stays on the OTP step", async ({
  page,
}) => {
  const calls: string[] = [];
  await mockRequestOk(page, calls);
  await page.route("**/api/member-auth/otp/verify", async (route) => {
    calls.push("verify");
    await fulfillJson(route, 400, {
      error: {
        code: "INVALID_OR_EXPIRED_CODE",
        message:
          "That code is invalid or has expired. Request a new code and try again.",
      },
    });
  });

  await page.goto(SIGN_IN_URL);
  await page.getByLabel("Mobile number").fill(PHONE);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("6-digit code").fill("000000");
  await page.getByRole("button", { name: "Verify" }).click();

  await expect(
    page.getByText(
      "That code didn't work. It may be wrong, expired, or too many attempts were made.",
    ),
  ).toBeVisible();
  // Still on the OTP step: the code entry and Verify action remain,
  // and linking was never attempted.
  await expect(page.getByLabel("6-digit code")).toBeVisible();
  await expect(page.getByRole("button", { name: "Verify" })).toBeVisible();
  expect(calls).toEqual(["request", "verify"]);
});

test("verify success links exactly once and navigates to the check-in landing", async ({
  page,
}) => {
  const calls: string[] = [];
  await mockRequestOk(page, calls);
  await page.route("**/api/member-auth/otp/verify", async (route) => {
    calls.push("verify");
    await fulfillJson(route, 200, { verified: true });
  });
  await page.route("**/api/member-auth/link", async (route) => {
    calls.push("link");
    await fulfillJson(route, 200, { linked: true });
  });

  await page.goto(SIGN_IN_URL);
  await page.getByLabel("Mobile number").fill(PHONE);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: "Verify" }).click();

  // The probe: whatever the link response claimed, the flow navigates
  // to the check-in landing for this gym, which renders from the
  // actual session. Endpoint order and single-call counts are pinned.
  await expect(page).toHaveURL(new RegExp(`/member/check-in\\?gym=${GYM_ID}$`));
  expect(calls).toEqual(["request", "verify", "link"]);
  expect(page.url()).toContain(CHECK_IN_URL);
});

test("a failed link still navigates to the probe — link is never retried", async ({
  page,
}) => {
  const calls: string[] = [];
  await mockRequestOk(page, calls);
  await page.route("**/api/member-auth/otp/verify", async (route) => {
    calls.push("verify");
    await fulfillJson(route, 200, { verified: true });
  });
  await page.route("**/api/member-auth/link", async (route) => {
    calls.push("link");
    await fulfillJson(route, 500, {
      error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
    });
  });

  await page.goto(SIGN_IN_URL);
  await page.getByLabel("Mobile number").fill(PHONE);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: "Verify" }).click();

  await expect(page).toHaveURL(new RegExp(`/member/check-in\\?gym=${GYM_ID}$`));
  // Exactly one link attempt despite the failure: the challenge may
  // already be consumed server-side, and the landing page (rendered
  // from the real session) is the ground truth.
  expect(calls).toEqual(["request", "verify", "link"]);
});

test("duplicate Continue clicks produce exactly one OTP request", async ({
  page,
}) => {
  let requestCount = 0;
  await page.route("**/api/member-auth/otp/request", async (route) => {
    requestCount += 1;
    await delay(600);
    await fulfillJson(route, 200, { challengeId: "challenge-e2e" });
  });

  await page.goto(SIGN_IN_URL);
  await page.getByLabel("Mobile number").fill(PHONE);
  await page.getByRole("button", { name: "Continue" }).dblclick();

  await expect(page.getByLabel("6-digit code")).toBeVisible();
  expect(requestCount).toBe(1);
});

test("duplicate Verify clicks produce exactly one verification", async ({
  page,
}) => {
  const calls: string[] = [];
  await mockRequestOk(page, calls);
  let verifyCount = 0;
  await page.route("**/api/member-auth/otp/verify", async (route) => {
    verifyCount += 1;
    calls.push("verify");
    await delay(600);
    await fulfillJson(route, 200, { verified: true });
  });
  await page.route("**/api/member-auth/link", async (route) => {
    calls.push("link");
    await fulfillJson(route, 200, { linked: true });
  });

  await page.goto(SIGN_IN_URL);
  await page.getByLabel("Mobile number").fill(PHONE);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: "Verify" }).dblclick();

  await expect(page).toHaveURL(new RegExp(`/member/check-in\\?gym=${GYM_ID}$`));
  expect(verifyCount).toBe(1);
  expect(calls).toEqual(["request", "verify", "link"]);
});
