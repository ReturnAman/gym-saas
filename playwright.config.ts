import { defineConfig, devices } from "@playwright/test";

// 127.0.0.1 instead of "localhost": Chromium's DNS resolver on CI runners
// fails to resolve "localhost" (net::ERR_NAME_NOT_RESOLVED) even though
// Node.js resolves it fine — the Node-based `request` test and Playwright's
// own webServer health check pass while every `page.goto` fails. A literal
// IPv4 address bypasses DNS in both stacks, so the browser and the server
// always agree on where the app lives.
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
        launchOptions: {
          // Never proxy the test browser: the specs only talk to the local
          // test server, and a proxy can never route to the runner's own
          // loopback. Without this, Chromium picks up the runner's
          // *_proxy environment variables and every navigation fails with
          // net::ERR_NAME_NOT_RESOLVED — even for a literal 127.0.0.1 —
          // while Node-based checks (webServer probe, `request` fixture)
          // succeed because Node ignores those variables.
          args: ["--no-proxy-server"],
        },
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
