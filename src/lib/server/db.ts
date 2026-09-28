// Single shared PrismaClient for the Next.js server.
//
// A new client per request (or per hot-reload) exhausts the database
// connection pool, so the client is cached on globalThis in development.
// This module is server-only: never import it from client components.
//
// Prisma 7 connects through a driver adapter (see prisma.config.ts for the
// CLI-side datasource configuration).

import "server-only";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "./env";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

const adapter = new PrismaPg({ connectionString: env.databaseUrl });

export const db: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (env.nodeEnv !== "production") {
  globalForPrisma.prisma = db;
}
