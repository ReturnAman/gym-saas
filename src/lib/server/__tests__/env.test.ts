import { describe, expect, it } from "vitest";
import { validateEnv } from "@/lib/server/env";

const BASE = {
  NODE_ENV: "test",
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/gymsaas",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x",
  CLERK_SECRET_KEY: "sk_test_x",
} as const;

describe("validateEnv", () => {
  it("accepts a complete server environment", () => {
    const env = validateEnv({ ...BASE });
    expect(env.nodeEnv).toBe("test");
    expect(env.appUrl).toBe("http://localhost:3000");
    expect(env.databaseUrl).toBe("postgresql://user:pass@localhost:5432/gymsaas");
    expect(env.clerkPublishableKey).toBe("pk_test_x");
    expect(env.clerkSecretKey).toBe("sk_test_x");
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

  it("requires both Clerk keys now that authentication is implemented", () => {
    const withoutPublishable: NodeJS.ProcessEnv = { ...BASE };
    delete withoutPublishable.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    expect(() => validateEnv(withoutPublishable)).toThrow(
      /NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY/,
    );

    const withoutSecret: NodeJS.ProcessEnv = { ...BASE };
    delete withoutSecret.CLERK_SECRET_KEY;
    expect(() => validateEnv(withoutSecret)).toThrow(/CLERK_SECRET_KEY/);
  });

  it("accepts the standard Clerk variable names", () => {
    const env = validateEnv({
      ...BASE,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x",
      CLERK_SECRET_KEY: "sk_test_x",
    });
    expect(env.clerkPublishableKey).toBe("pk_test_x");
    expect(env.clerkSecretKey).toBe("sk_test_x");
  });
});
