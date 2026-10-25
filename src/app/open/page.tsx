import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/server/auth";
import { getPrimaryMembership } from "@/lib/server/authorization";
import { getMemberContext, readMemberSessionToken } from "@/lib/server/member-session";

import styles from "./open.module.css";

/**
 * Installed-PWA entry point. A valid gym-scoped member session goes to the
 * member area; a Clerk owner/staff session goes to its organization area.
 * Signed-out visitors get a compact app entry screen (not the marketing
 * homepage) so they can choose the correct authentication path.
 */
export default async function OpenAppPage() {
  const memberContext = await getMemberContext();
  if (memberContext) {
    redirect("/member");
  }

  // A stale/expired member token should stay on the member recovery path,
  // rather than sending a member to the owner/staff Clerk login.
  const memberToken = await readMemberSessionToken();
  if (memberToken) {
    redirect("/member");
  }

  const user = await getCurrentUser();
  if (user) {
    const membership = await getPrimaryMembership(user.id);
    if (!membership) {
      redirect("/onboarding");
    }
    redirect("/app/org");
  }

  return (
    <main className={styles.page}>
      <section className={styles.content} aria-labelledby="entry-title">
        <Link href="/" className={styles.brand} aria-label="Gym SaaS public website">
          <span className={styles.brandMark} aria-hidden="true">💪</span>
          <span className={styles.brandName}>gym<span>saas</span></span>
        </Link>

        <p className={styles.eyebrow}><span /> YOUR GYM. YOUR WORKSPACE.</p>
        <h1 id="entry-title">Where would you like to go?</h1>
        <p className={styles.description}>
          Sign in to pick up where you left off. We’ll take you to the right place next time.
        </p>

        <div className={styles.choices}>
          <Link href="/sign-in" className={styles.choice}>
            <span className={styles.choiceIcon} aria-hidden="true">↗</span>
            <span className={styles.choiceCopy}>
              <strong>Gym owner or staff</strong>
              <small>Manage members, attendance and payment follow-ups.</small>
            </span>
            <span className={styles.arrow} aria-hidden="true">→</span>
          </Link>

          <Link href="/member/scan" className={styles.choice}>
            <span className={styles.choiceIcon} aria-hidden="true">⌗</span>
            <span className={styles.choiceCopy}>
              <strong>I’m a member</strong>
              <small>Scan your gym’s QR code to open your member area.</small>
            </span>
            <span className={styles.arrow} aria-hidden="true">→</span>
          </Link>
        </div>

        <p className={styles.footnote}>
          One platform for gyms and fitness studios. Each gym has its own workspace.
        </p>
      </section>
    </main>
  );
}
