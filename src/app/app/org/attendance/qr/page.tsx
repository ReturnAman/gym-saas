import Link from "next/link";
import { redirect } from "next/navigation";

import QRCode from "qrcode";

import { buildMemberCheckInUrl } from "@/lib/attendance";
import { requireOrganizationContext } from "@/lib/server/authorization";
import { canViewAttendance } from "@/lib/server/attendance";
import { env } from "@/lib/server/env";

import styles from "../attendance.module.css";
import { PrintButton } from "./print-button";

/**
 * Gym QR poster (protected).
 *
 * The printed code encodes ONLY this gym's member check-in URL: the
 * organization is resolved from the signed-in user's server-side
 * context (never from client input), and the URL is built from the
 * validated APP_URL via buildMemberCheckInUrl. The QR identifies the
 * gym — it authenticates nobody (ADR 022); members still sign in with
 * phone OTP and check in against their gym-scoped session.
 *
 * Authorization: the same view permission as the attendance screens
 * (OWNER, ADMIN, STAFF, TRAINER). Anyone else is redirected back to
 * the attendance page.
 *
 * Fail-safe configuration: if APP_URL is missing (`env.appUrl` resolves
 * lazily and throws on access) or is not a valid http(s) URL, the page
 * renders a configuration message and NO QR code — a misleading code
 * is worse than none.
 */

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The member check-in URL for this gym, or null when the configured
 * APP_URL cannot produce a trustworthy one.
 */
function resolveCheckInUrl(organizationId: string): string | null {
  try {
    const appUrl = env.appUrl;
    if (!appUrl || !isValidHttpUrl(appUrl)) {
      return null;
    }
    return buildMemberCheckInUrl(appUrl, organizationId);
  } catch {
    return null;
  }
}

export default async function GymQrPage() {
  const { organization, membership } = await requireOrganizationContext();
  if (!canViewAttendance(membership.role)) {
    redirect("/app/org/attendance");
  }

  const checkInUrl = resolveCheckInUrl(organization.id);

  // The QR SVG is generated locally by the `qrcode` package from the
  // validated URL — no external QR service is involved. Generation is
  // only attempted with a validated URL; any failure falls back to the
  // same safe configuration state as an invalid APP_URL.
  let qrSvg: string | null = null;
  if (checkInUrl) {
    try {
      qrSvg = await QRCode.toString(checkInUrl, {
        type: "svg",
        margin: 1,
        width: 320,
      });
    } catch {
      qrSvg = null;
    }
  }

  if (!checkInUrl || !qrSvg) {
    return (
      <main>
        <h1>Gym QR code</h1>
        <p>
          The member check-in address is not configured. Ask an
          administrator to set a valid APP_URL for the application, then
          reload this page.
        </p>
        <p className={styles.noPrint}>
          <Link href="/app/org/attendance">Back to attendance</Link>
        </p>
      </main>
    );
  }

  return (
    <main>
      <div className={styles.poster}>
        <h1>{organization.name}</h1>
        <div
          className={styles.qrSvg}
          dangerouslySetInnerHTML={{ __html: qrSvg }}
        />
        <p className={styles.posterCaption}>Scan to check in</p>
        <p className={styles.checkInUrl}>{checkInUrl}</p>
      </div>

      <div className={styles.noPrint}>
        <PrintButton />
        <p className={styles.hint}>
          Print and display this code at the gym entrance. The code opens
          this gym&apos;s member check-in page — members still sign in
          with their phone, so the code alone grants no access. If the
          app&apos;s web address (APP_URL) ever changes, reprint this
          poster: codes printed with the old address will stop working.
        </p>
        <p>
          <Link href="/app/org/attendance">Back to attendance</Link>
        </p>
      </div>
    </main>
  );
}
