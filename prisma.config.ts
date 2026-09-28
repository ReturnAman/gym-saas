// Prisma configuration (Prisma 7+).
//
// The database connection string comes from the DATABASE_URL environment
// variable. Treat it as a secret: placeholders only in .env.example, real
// values only in local .env.local (gitignored) or the deployment target.

import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
