// Server-safe environment configuration.
//
// This module MUST only ever be imported from server code (route handlers,
// server components, server actions, scripts). The `server-only` import makes
// a client-side import fail the build instead of leaking secrets.
//
// Rules:
// - Secrets live in the environment, never in source (see .env.example).
// - Browser-exposed variables must be declared explicitly in `publicEnv`.
// - Missing required server variables fail fast with a clear message.

import "server-only";

export type NodeEnv = "development" | "test" | "production";

export interface ServerEnv {
  nodeEnv: NodeEnv;
  appUrl: string;
  databaseUrl: string;
  /** Clerk is the accepted auth provider (ADR 001). Standard Clerk variable
   *  names; required now that authentication is implemented. The publishable
   *  key is public by design (NEXT_PUBLIC_); the secret key never leaves the
   *  server. */
  clerkPublishableKey: string;
  clerkSecretKey: string;
}

function required(name: string, source: NodeJS.ProcessEnv): string {
  const value = source[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

function parseNodeEnv(source: NodeJS.ProcessEnv): NodeEnv {
  const nodeEnv = source.NODE_ENV ?? "development";
  if (nodeEnv !== "development" && nodeEnv !== "test" && nodeEnv !== "production") {
    throw new Error(
      `Invalid NODE_ENV: ${JSON.stringify(nodeEnv)}. ` +
        `Expected "development", "test", or "production".`,
    );
  }
  return nodeEnv;
}

export function validateEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  return {
    nodeEnv: parseNodeEnv(source),
    appUrl: required("APP_URL", source),
    databaseUrl: required("DATABASE_URL", source),
    clerkPublishableKey: required("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", source),
    clerkSecretKey: required("CLERK_SECRET_KEY", source),
  };
}

/**
 * Client-exposed variables live here and ONLY here.
 * Nothing reaches the browser unless it is listed explicitly.
 * (No NEXT_PUBLIC_* variables are needed by the foundation.)
 */
export const publicEnv = {} as const;

/**
 * The shared, eagerly validated environment.
 *
 * The core variables (NODE_ENV, DATABASE_URL, and both Clerk keys) are
 * validated at module load, exactly as before — the application cannot
 * run without them, and consumers such as the database module rely on
 * that fail-fast behavior.
 *
 * `appUrl` is the single exception: it resolves lazily on access. Its
 * only consumer is the gym QR poster page, which must be able to render
 * a configuration message when APP_URL is missing or unusable instead
 * of the whole module graph failing at import time. Accessing
 * `env.appUrl` still validates with the same `required` rule and throws
 * the same error when APP_URL is absent — the failure simply moves from
 * import time to the one place that can present it safely. Use
 * `validateEnv()` directly when an all-at-once strict check is needed.
 */
export const env: ServerEnv = {
  nodeEnv: parseNodeEnv(process.env),
  databaseUrl: required("DATABASE_URL", process.env),
  clerkPublishableKey: required("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", process.env),
  clerkSecretKey: required("CLERK_SECRET_KEY", process.env),
  get appUrl(): string {
    return required("APP_URL", process.env);
  },
};
