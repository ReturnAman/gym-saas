import "server-only";

import { db } from "@/lib/server/db";
import { findClerkDisplayNamesById } from "@/lib/server/clerk-directory";

/**
 * Display labels for staff rows, keyed by LOCAL user ID.
 *
 * The staff service deliberately returns no names or emails for list
 * entries (least data), so the page enriches rows for display here:
 * local user IDs are bridged to Clerk IDs through the User table —
 * entirely on the server; Clerk IDs are used only as lookup keys and
 * are never returned, rendered, or sent to the client — and the names
 * themselves come from the Clerk directory seam. Any gap (a user with
 * no Clerk link, an account Clerk no longer returns, a provider
 * outage) degrades to a null label and the page renders a fallback.
 */
export async function getStaffDisplayNames(
  userIds: string[],
): Promise<Map<string, string | null>> {
  const labels = new Map<string, string | null>();
  if (userIds.length === 0) {
    return labels;
  }
  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, clerkUserId: true },
  });
  const clerkIds = users
    .map((user) => user.clerkUserId)
    .filter((value): value is string => Boolean(value));
  const byClerkId = await findClerkDisplayNamesById(clerkIds);
  for (const user of users) {
    labels.set(
      user.id,
      user.clerkUserId ? (byClerkId.get(user.clerkUserId) ?? null) : null,
    );
  }
  return labels;
}
