import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Prisma client singleton (Phase 4 pool fix).
 *
 * `db.ts` must cache the PrismaClient on globalThis in EVERY
 * environment, production included. Previously the cache was only
 * READ in production, never written, so when Next.js evaluated the
 * module in a second module graph (page components vs route
 * handlers) the second evaluation built a second client — and a
 * second connection pool of the same size (measured live: two
 * pools of max 8 in one process, 2026-10-19).
 *
 * The test exploits the asymmetry between the module registry and
 * globalThis: `vi.resetModules()` makes the next dynamic import
 * re-run db.ts's top-level code, but globalThis survives — so only
 * the globalThis cache can return the identical client. No database
 * is contacted: constructing a PrismaClient is lazy (the pg
 * adapter creates its pool on connect(), i.e. on first query),
 * and the Vitest placeholder DATABASE_URL is never dialed.
 *
 * Isolation: stubs are installed per test and removed in
 * afterEach (the env.test.ts pattern); Vitest isolates module
 * registries per test file, so the production-mode evaluation
 * below cannot leak into other suites.
 */
describe("db client singleton", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function importDbFresh(nodeEnv: string) {
    vi.stubEnv("NODE_ENV", nodeEnv);
    vi.resetModules();
    const first = (await import("@/lib/server/db")).db;
    vi.resetModules();
    const second = (await import("@/lib/server/db")).db;
    return { first, second };
  }

  it("reuses one PrismaClient across production module re-evaluations", async () => {
    const { first, second } = await importDbFresh("production");
    expect(second).toBe(first);
  });

  it("reuses one PrismaClient across development module re-evaluations", async () => {
    const { first, second } = await importDbFresh("development");
    expect(second).toBe(first);
  });
});
