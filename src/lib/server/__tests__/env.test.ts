import { describe, expect, it } from "vitest";
import { validateEnv } from "@/lib/server/env";

const BASE = {
  NODE_ENV: "test",
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/gymsaas",
} as const;

describe("validateEnv", () => {
  it("accepts a complete server environment", () => {
    const env = validateEnv({ ...BASE });
    expect(env.nodeEnv).toBe("test");
    expect(env.appUrl).toBe("http://localhost:3000");
    expect(env.databaseUrl).toBe("postgresql://user:pass@localhost:5432/gymsaas");
  });

  it("fails clearly when DATABASE_URL is missing", () => {
    const withoutDb: NodeJS.ProcessEnv = { ...BASE };
    delete withoutDb.DATABASE_URL;
    expect(() => validateEnv(withoutDb)).toThrow(/DATABASE_URL/);
  });

  it("fails clearly when APP_URL is missing", () => {
    const withoutAppUrl: NodeJS.ProcessEnv = { ...BASE };
    delete withoutAppUrl.APP_URL;
    expect(() => validateEnv(withoutAppUrl)).toThrow(/APP_URL/);
  });

  it("rejects an invalid NODE_ENV", () => {
    // Intentionally invalid: cast because the type only allows known values.
    const invalid = { ...BASE, NODE_ENV: "staging" } as unknown as NodeJS.ProcessEnv;
    expect(() => validateEnv(invalid)).toThrow(/NODE_ENV/);
  });

  it("treats Clerk keys as optional until authentication is implemented", () => {
    const env = validateEnv({ ...BASE });
    expect(env.clerkPublishableKey).toBeUndefined();
    expect(env.clerkSecretKey).toBeUndefined();

    const withClerk = validateEnv({
      ...BASE,
      CLERK_PUBLISHABLE_KEY: "pk_test_x",
      CLERK_SECRET_KEY: "sk_test_x",
    });
    expect(withClerk.clerkSecretKey).toBe("sk_test_x");
  });
});
