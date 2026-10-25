import Link from "next/link";
import { redirect } from "next/navigation";

import { requireCurrentUser } from "@/lib/server/auth";
import { getPrimaryMembership } from "@/lib/server/authorization";
import { MAX_ORGANIZATION_NAME_LENGTH } from "@/lib/server/organizations";

import { createOrganizationAction } from "./actions";
import styles from "./onboarding.module.css";

export default async function OnboardingPage() {
  const user = await requireCurrentUser();
  const membership = await getPrimaryMembership(user.id);
  if (membership) {
    redirect("/app/org");
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}><span>G</span><strong>gymsaas<small>GYM OPERATIONS</small></strong></Link>
        <Link href="/sign-in" className={styles.headerLink}>Already signed in <span aria-hidden="true">✓</span></Link>
      </header>
      <section className={styles.content}>
        <div className={styles.stepLabel}><span>01</span> YOUR WORKSPACE STARTS HERE</div>
        <h1>Give your gym<br /><em>a home.</em></h1>
        <p className={styles.description}>Create your gym workspace to organise member profiles, daily attendance and payment records in one place.</p>
        <form action={createOrganizationAction} className={styles.form}>
          <label htmlFor="name">Gym name</label>
          <input id="name" name="name" type="text" required maxLength={MAX_ORGANIZATION_NAME_LENGTH} autoComplete="organization" placeholder="e.g. Northside Fitness" />
          <p className={styles.hint}>You’ll be the owner of this workspace. You can add the rest of your gym details in settings.</p>
          <button type="submit" aria-label="Create gym">Create gym workspace <span aria-hidden="true">→</span></button>
        </form>
        <div className={styles.secureNote}><span>✓</span> Your workspace and member records are kept within your gym.</div>
      </section>
      <aside className={styles.sidePanel}>
        <div className={styles.sideArt} aria-hidden="true"><span className={styles.orbitOne} /><span className={styles.orbitTwo} /><span className={styles.glyph}>G<span>.</span></span></div>
        <div className={styles.sideCopy}><span>BUILT FOR THE DAILY ROUTINE</span><h2>Make room for<br />the work that matters.</h2><p>A clear place for the people, visits and payments that keep your community moving.</p></div>
        <div className={styles.sideNumber}>GYMSAAS <span>·</span> STAGE 01</div>
      </aside>
    </main>
  );
}
