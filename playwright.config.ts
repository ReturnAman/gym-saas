import { defineConfig, devices } from "@playwright/test";

const APP_ORIGIN = "http://127.0.0.1:3000";

// Clerk keys for the webServer process. In CI they come from the dedicated
// CI development instance (GitHub Actions secrets, wired in ci.yml): a real
// test-mode instance is required because browser navigations must complete
// Clerk's dev-browser handshake, and the dummy key used locally encodes a
// nonexistent instance ("dummy.local"), so every browser navigation fails
// with net::ERR_NAME_NOT_RESOLVED. Fail fast in CI if the secrets were not
// supplied — never fall back to the dummy key there. Locally, the dummy
// keys remain as a fallback so the app boots without real credentials.
const isCI = !!process.env.CI;
const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const clerkSecretKey = process.env.CLERK_SECRET_KEY;
if (isCI && (!clerkPublishableKey || !clerkSecretKey)) {
  throw new Error(
    "CI requires NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY " +
      "from the dedicated CI Clerk instance (GitHub Actions secrets " +
      "CLERK_CI_PUBLISHABLE_KEY / CLERK_CI_SECRET_KEY).",
  );
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: APP_ORIGIN,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium",
      },
    },
  ],
  webServer: {
    // Local runs reuse a dev server if one is already up; CI builds and
    // serves the production build for a realistic smoke test.
    command: process.env.CI ? "npm run build && npm start" : "npm run dev",
    url: APP_ORIGIN,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // The server gets the CI instance keys in CI (passed through from the
    // environment; their presence is enforced above). Locally it falls back
    // to format-valid dummy keys so the app boots without real credentials.
    env: {
      APP_URL: APP_ORIGIN,
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://ci:ci@localhost:5432/gymsaas_ci",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
        clerkPublishableKey ?? "pk_test_ZHVtbXkubG9jYWwk",
      CLERK_SECRET_KEY: clerkSecretKey ?? "sk_test_dummy",
    },
  },
});
