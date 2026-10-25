import Link from "next/link";

import styles from "./landing.module.css";

const featureCards = [
  {
    number: "01",
    title: "Members, organised",
    description: "Keep member profiles, plans, expiry dates and balances in one clear workspace.",
    icon: "users",
  },
  {
    number: "02",
    title: "Attendance at a glance",
    description: "See who checked in today and keep daily check-in and check-out records tidy.",
    icon: "activity",
  },
  {
    number: "03",
    title: "Payments you can trust",
    description: "Record received payments and review member claims without confusing a claim with a confirmed payment.",
    icon: "wallet",
  },
];

export default function Home() {
  return (
    <main className={styles.page}>
      <header className={styles.navbar}>
        <Link href="/" className={styles.brand} aria-label="Gym SaaS home">
          <span className={styles.brandMark}>G</span>
          <span className={styles.brandWords}>
            <strong>gym<span>saas</span></strong>
            <small>GYM OPERATIONS</small>
          </span>
        </Link>
        <div className={styles.navActions}>
          <Link href="/api/health" className={styles.statusLink}>
            <span className={styles.statusDot} />
            Service status
          </Link>
          <Link href="/sign-in" className={styles.signInLink}>Sign in <span aria-hidden="true">↗</span></Link>
        </div>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <div className={styles.eyebrow}><span /> THE CALMER WAY TO RUN YOUR GYM</div>
          <h1>Less admin.<br /><span>More momentum.</span></h1>
          <p className={styles.heroCopy}>
            One workspace for your members, attendance and payment records — so you can spend less time chasing details and more time building your gym community.
          </p>
          <div className={styles.heroActions}>
            <Link href="/app" className={styles.primaryCta}>Open your workspace <span aria-hidden="true">→</span></Link>
            <Link href="/sign-in" className={styles.secondaryCta}>Sign in to continue</Link>
          </div>
          <div className={styles.trustRow}>
            <span className={styles.trustIcon}>✓</span>
            <span>Simple by design</span>
            <i />
            <span>Built for day-to-day gym operations</span>
          </div>
        </div>

        <div className={styles.preview} aria-label="Preview of the gym dashboard">
          <div className={styles.previewTop}>
            <div className={styles.previewBrand}><span className={styles.previewMark}>G</span><span>Workspace</span></div>
            <span className={styles.previewDate}>TODAY · OVERVIEW</span>
          </div>
          <div className={styles.previewHeading}>
            <span>YOUR GYM, IN RHYTHM</span>
            <strong>A clearer view of today.</strong>
          </div>
          <div className={styles.previewStats}>
            <div className={styles.previewStat}><span>Members</span><strong>—</strong><small>Member directory</small></div>
            <div className={styles.previewStat}><span>Check-ins</span><strong>—</strong><small>Today's activity</small></div>
          </div>
          <div className={styles.previewList}>
            <div className={styles.previewListTitle}><strong>Everyday operations</strong><span>READY TO ORGANISE</span></div>
            <div className={styles.previewRow}><span className={styles.rowIcon}>01</span><span><strong>Members</strong><small>Profiles, plans and balances</small></span><b>↗</b></div>
            <div className={styles.previewRow}><span className={styles.rowIcon}>02</span><span><strong>Attendance</strong><small>Today's visits and open sessions</small></span><b>↗</b></div>
            <div className={styles.previewRow}><span className={styles.rowIcon}>03</span><span><strong>Payments</strong><small>Clear, auditable payment records</small></span><b>↗</b></div>
          </div>
          <div className={styles.previewBottom}><span className={styles.bottomPulse} /> A focused workspace for your team</div>
          <div className={styles.previewBlob} />
        </div>
        <div className={styles.heroFootnote}><span>DESIGNED FOR DAILY USE</span><span>01 / YOUR OPERATIONS, ONE PLACE</span></div>
      </section>

      <section className={styles.features}>
        <div className={styles.featuresIntro}>
          <span className={styles.sectionEyebrow}>THE WORK, MADE CLEARER</span>
          <h2>Everything important,<br />easy to find.</h2>
          <p>Practical tools for the routines that keep a gym running smoothly.</p>
        </div>
        <div className={styles.featureGrid}>
          {featureCards.map((feature) => (
            <article key={feature.number} className={styles.featureCard}>
              <div className={styles.featureCardTop}><span>{feature.number}</span><span className={styles.featureArrow}>↗</span></div>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className={styles.footer}>
        <Link href="/" className={styles.footerBrand}><span className={styles.brandMark}>G</span> gymsaas</Link>
        <span>Clear records. Confident decisions.</span>
        <Link href="/api/health">Service health ↗</Link>
      </footer>
    </main>
  );
}
