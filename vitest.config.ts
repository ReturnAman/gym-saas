import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
      // In tests, resolve `server-only` to its empty server entry —
      // mirroring how Next.js resolves it in Server Components/Routes.
      // (Without this, Vitest loads the stub that throws on import.)
      "server-only": path.resolve(rootDir, "node_modules/server-only/empty.js"),
    },
  },
  test: {
    // Foundation: unit and application-level tests run in Node.
    // Browser/E2E tests belong to Playwright (tests/e2e), not Vitest.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // The env module validates on import, so unit tests must not depend on
    // ambient developer/CI environment. Placeholders only — real secrets
    // never belong here; tests that need specific values pass explicit
    // sources to validateEnv().
    env: {
      NODE_ENV: "test",
      APP_URL: "http://localhost:3000",
      DATABASE_URL:
        process.env.RUN_DB_TESTS === "true" && process.env.DATABASE_URL
          ? process.env.DATABASE_URL
          : "postgresql://user:pass@localhost:5432/gymsaas",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_vitest",
      CLERK_SECRET_KEY: "sk_test_vitest",
    },
  },
});
