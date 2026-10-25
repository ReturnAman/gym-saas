import Link from "next/link";
import { SignIn } from "@clerk/nextjs";

import styles from "./sign-in.module.css";

export default function SignInPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}><span>G</span><strong>gymsaas<small>GYM OPERATIONS</small></strong></Link>
        <Link href="/" className={styles.backLink}>← Back to home</Link>
      </header>
      <section className={styles.authLayout}>
        <div className={styles.intro}>
          <span className={styles.eyebrow}><i /> YOUR GYM, IN RHYTHM</span>
          <h1>Good to have<br /><em>you back.</em></h1>
          <p>Sign in to your workspace and pick up where you left off. Your gym&apos;s everyday operations, all in one place.</p>
          <div className={styles.benefitList}>
            <span><b>✓</b> Member profiles and memberships</span>
            <span><b>✓</b> Attendance and payment records</span>
            <span><b>✓</b> Clear, accountable workflows</span>
          </div>
          <div className={styles.decor} aria-hidden="true"><span>G<span>.</span></span></div>
        </div>
        <div className={styles.authCard}>
          <div className={styles.authCardHeader}><span>WELCOME BACK</span><h2>Sign in to Gym SaaS</h2><p>Use the account connected to your gym workspace.</p></div>
          <div className={styles.clerkMount}><SignIn fallbackRedirectUrl="/open" signUpFallbackRedirectUrl="/open" /></div>
          <p className={styles.authFootnote}><span>✳</span> Secure sign-in powered by Clerk</p>
        </div>
      </section>
    </main>
  );
}
