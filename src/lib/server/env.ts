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
  /** Clerk is the accepted auth provider (ADR 001). Keys stay optional until
   *  authentication is implemented in a later issue. */
  clerkPublishableKey?: string;
  clerkSecretKey?: string;
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

function optional(name: string, source: NodeJS.ProcessEnv): string | undefined {
  return source[name] || undefined;
}

export function validateEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const nodeEnv = source.NODE_ENV ?? "development";
  if (nodeEnv !== "development" && nodeEnv !== "test" && nodeEnv !== "production") {
    throw new Error(
      `Invalid NODE_ENV: ${JSON.stringify(nodeEnv)}. ` +
        `Expected "development", "test", or "production".`,
    );
  }
  return {
    nodeEnv,
    appUrl: required("APP_URL", source),
    databaseUrl: required("DATABASE_URL", source),
    clerkPublishableKey: optional("CLERK_PUBLISHABLE_KEY", source),
    clerkSecretKey: optional("CLERK_SECRET_KEY", source),
  };
}

/**
 * Client-exposed variables live here and ONLY here.
 * Nothing reaches the browser unless it is listed explicitly.
 * (No NEXT_PUBLIC_* variables are needed by the foundation.)
 */
export const publicEnv = {} as const;

export const env: ServerEnv = validateEnv();
