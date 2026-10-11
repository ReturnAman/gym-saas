import { clerkSetup } from "@clerk/testing/playwright";

/**
 * Playwright global setup for the authenticated harness.
 *
 * clerkSetup() fetches the Clerk testing token from the Backend API
 * and stores it — together with the Frontend API URL — in
 * process.env (CLERK_TESTING_TOKEN / CLERK_FAPI). It must run here, in
 * the runner's main process before any worker starts: workers inherit
 * this environment, whereas values set inside a test stay local to
 * that test's worker process and would be missing on retries, in
 * other workers, and in dependent projects. The package's own error
 * message directs callers to call clerkSetup "during your global
 * setup" before setupClerkTestingToken is used.
 */
export default async function globalSetup(): Promise<void> {
  await clerkSetup();
}
