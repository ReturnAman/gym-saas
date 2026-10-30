import Link from "next/link";

import {
  getPlatformAdminOverview,
  requirePlatformAdmin,
} from "@/lib/server/platform-admin";

/**
 * Platform-admin dashboard (trial/subscription slice).
 *
 * Access is allowlisted Clerk user IDs only (see platform-admin.ts) —
 * gym roles grant nothing here. Every number below is counted from live
 * database rows at request time; nothing is seeded or fabricated.
 */

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
});

function formatRemaining(ms: number | null): string {
  if (ms === null) return "—";
  const days = Math.floor(ms / (24 * 60 * 60_000));
  if (days >= 1) return `${days}d left`;
  const hours = Math.ceil(ms / (60 * 60_000));
  return `${hours}h left`;
}

export default async function PlatformAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requirePlatformAdmin();
  const params = await searchParams;
  const overview = await getPlatformAdminOverview(params.q ?? "");

  return (
    <main>
      <h1>Platform admin</h1>
      <p>SaaS trial and subscription management. No payment gateway is
        connected — payments here are manually verified records.</p>

      <h2>Overview</h2>
      <ul>
        <li>Active trials: {overview.metrics.activeTrials}</li>
        <li>Awaiting payment: {overview.metrics.awaitingPayment}</li>
        <li>Trials expiring within 48 hours: {overview.metrics.expiringWithin48Hours}</li>
        <li>Expired or suspended: {overview.metrics.expiredOrSuspended}</li>
        <li>Total gyms: {overview.metrics.totalOrganizations}</li>
      </ul>

      <form method="get">
        <label htmlFor="q">Search gyms</label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={params.q ?? ""}
        />
        <button type="submit">Search</button>
      </form>

      {overview.organizations.length === 0 ? (
        <p>No gyms found.</p>
      ) : (
        <ul>
          {overview.organizations.map((row) => (
            <li key={row.organization.id}>
              <Link href={`/platform-admin/orgs/${row.organization.id}`}>
                {row.organization.name}
              </Link>{" "}
              — {row.state}
              {row.ownerDisplayName && ` — owner: ${row.ownerDisplayName}`}
              {row.subscription?.trialEndsAt &&
                ` — trial ends ${dateFormat.format(row.subscription.trialEndsAt)} (${formatRemaining(row.trialRemainingMs)})`}
              {row.subscription?.paidThroughAt &&
                ` — paid through ${dateFormat.format(row.subscription.paidThroughAt)}`}
              {row.pendingOffer && " — offer requested"}
              {row.latestOffer?.status === "APPROVED" &&
                ` — offer approved ${row.latestOffer.discountPercent}%`}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
