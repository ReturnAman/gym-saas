import { defineConfig, devices } from "@playwright/test";

// Authenticated E2E (tests/e2e-auth): a real Clerk sign-in against the
// dedicated development instance, backed by a disposable PostgreSQL
// database. Unlike playwright.config.ts, NOTHING here falls back to
// dummy values — every required variable must be provided (locally via
// the developer's environment; in CI via the e2e-auth job), and the run
// fails fast when one is missing, so an unconfigured environment can
// never produce a green run. Production instances and databases are
// never used: the database is the caller's disposable one, and
// @clerk/testing's clerkSetup() itself refuses production secret keys.
const APP_ORIGIN = "http://127.0.0.1:3000";

const REQUIRED_ENV = [
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "DATABASE_URL",
  "CLERK_E2E_OWNER_EMAIL",
] as const;
const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
if (missing.length > 0) {
  throw new Error(
    `Authenticated E2E requires these environment variables: ${missing.join(", ")}. ` +
      "Provide them from the dedicated Clerk development instance, a disposable " +
      "PostgreSQL database, and the test-mode OWNER's email address.",
  );
}

// Database safety gate (local runs only). This harness WRITES to the
// database DATABASE_URL names: the setup creates an organization and
// memberships, and the documented local flow migrates it first. There
// is deliberately no hostname or database-name heuristic — a
// disposable database can live anywhere, and a dangerous one can be
// tunneled to localhost. Instead, a local operator must explicitly
// attest, via E2E_AUTH_DISPOSABLE_DATABASE=1, that DATABASE_URL points
// to a disposable database. CI needs no attestation: the e2e-auth job
// pins DATABASE_URL to its own disposable PostgreSQL service. The
// error below names the requirement only — never the URL or any part
// of it.
if (!process.env.CI && process.env.E2E_AUTH_DISPOSABLE_DATABASE !== "1") {
  throw new Error(
    "Local authenticated E2E requires E2E_AUTH_DISPOSABLE_DATABASE=1: your " +
      "explicit attestation that DATABASE_URL points to a disposable " +
      "database that this harness may migrate and write fixture data to. " +
      "Refusing to run without it.",
  );
}

export default defineConfig({
  testDir: "./tests/e2e-auth",
  globalSetup: "./tests/e2e-auth/global.setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: APP_ORIGIN,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "auth-setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "auth-chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium",
        storageState: "tests/e2e-auth/.auth/owner.json",
      },
      dependencies: ["auth-setup"],
    },
  ],
  webServer: {
    // CI builds and serves the production build, as in
    // playwright.config.ts. Deliberate difference: an existing server
    // is NEVER reused, locally or in CI — a server started earlier may
    // run with different Clerk keys or a different DATABASE_URL, and
    // silently testing against it would invalidate the harness. If
    // port 3000 is already taken, the run fails loudly instead.
    command: process.env.CI ? "npm run build && npm start" : "npm run dev",
    url: APP_ORIGIN,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      APP_URL: APP_ORIGIN,
      DATABASE_URL: process.env.DATABASE_URL as string,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env
        .NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY as string,
      CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY as string,
    },
  },
});
