import { defineConfig, devices } from "@playwright/test";

const APP_ORIGIN = "http://127.0.0.1:3000";

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
    // Dummy, format-valid Clerk keys so the app boots without real
    // credentials. The publishable key decodes to "dummy.local$" — a
    // nonexistent instance; real keys come from .env.local / CI secrets.
    // Unauthenticated-redirect behavior does not need a live Clerk instance.
    env: {
      APP_URL: APP_ORIGIN,
      DATABASE_URL: "postgresql://ci:ci@localhost:5432/gymsaas_ci",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_ZHVtbXkubG9jYWwk",
      CLERK_SECRET_KEY: "sk_test_dummy",
    },
  },
});
