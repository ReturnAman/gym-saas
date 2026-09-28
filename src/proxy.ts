import { clerkMiddleware } from "@clerk/nextjs/server";

// Establishes the Clerk auth context (session, userId) for every request.
// Route protection itself is enforced explicitly in server components via
// requireCurrentUser() — the proxy alone is not the security boundary.
// (Next.js 16 uses the `proxy` file convention; `middleware` is deprecated.)
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
