import Link from "next/link";

import styles from "./landing.module.css";

const features = [
  {
    number: "01",
    title: "Manage members",
    description: "Keep member profiles, membership plans, expiry dates and balances together.",
    icon: "↗",
    tone: "lime",
  },
  {
    number: "02",
    title: "Track attendance",
    description: "See today's check-ins, active visits and check-outs in one clear view.",
    icon: "◷",
    tone: "yellow",
  },
  {
    number: "03",
    title: "Review payments",
    description: "Review payment claims and confirm payments only after they are verified.",
    icon: "₹",
    tone: "blue",
  },
  {
    number: "04",
    title: "Manage access",
    description: "Give staff the right level of access to your gym workspace.",
    icon: "◎",
    tone: "orange",
  },
];

export default function Home() {
  return (
    <main className={styles.page} id="top">
      <div className={styles.announcement}>
        <span>Gym operations, made simpler for your everyday work.</span>
        <a href="#features">Discover features <span aria-hidden="true">↗</span></a>
      </div>

      <header className={styles.navWrap}>
        <nav className={styles.navbar} aria-label="Main navigation">
          <Link href="/" className={styles.brand} aria-label="Gym SaaS home">
            <span className={styles.brandMark} aria-hidden="true">💪</span>
            <span className={styles.brandName}>gym<span>saas</span></span>
          </Link>
          <div className={styles.navLinks}>
            <a href="#top" className={styles.navLink}>Home</a>
            <a href="#features" className={styles.navLink}>Features</a>
            <a href="#workspace" className={styles.navLink}>Workspace</a>
            <a href="#how-it-works" className={styles.navLink}>How it works</a>
          </div>
          <div className={styles.navActions}>
            <Link href="/sign-in" className={styles.loginLink}>Login</Link>
            <Link href="/sign-in" className={styles.getStarted}>Get Started</Link>
          </div>
        </nav>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <p className={styles.eyebrow}><span /> GYM MANAGEMENT, WITHOUT THE CLUTTER</p>
          <h1>Simplify Your<br /><span>Gym Operations</span></h1>
          <p className={styles.heroCopy}>
            Manage members, track attendance and review payment records from one focused gym management workspace.
          </p>
          <div className={styles.heroActions}>
            <Link href="/sign-in" className={styles.primaryCta}>Get Started <span aria-hidden="true">↗</span></Link>
            <a href="#features" className={styles.secondaryCta}>Explore Features</a>
          </div>
        </div>

        <div className={styles.browser} id="workspace" aria-label="Preview of the Gym SaaS workspace">
          <div className={styles.browserBar}>
            <div className={styles.windowDots} aria-hidden="true"><i /><i /><i /></div>
            <div className={styles.addressBar}><span aria-hidden="true">⌑</span> app.gymsaas.com</div>
            <span className={styles.browserAction} aria-hidden="true">↻</span>
          </div>
          <div className={styles.previewApp}>
            <div className={styles.previewHeader}>
              <div className={styles.previewBrand}><span className={styles.previewMark}>💪</span><span><strong>gymsaas</strong><small>GYM MANAGEMENT</small></span></div>
              <div className={styles.previewTabs}><span className={styles.previewTabActive}>Home</span><span>Members</span><span>Attendance</span><span>Payments</span></div>
              <span className={styles.previewAvatar} aria-hidden="true">G</span>
            </div>
            <div className={styles.previewGrid}>
              <div className={styles.previewWelcome}>
                <span className={styles.previewEyebrow}>YOUR GYM, AT A GLANCE</span>
                <strong>Manage your<br />fitness business</strong>
                <span className={styles.previewDate}>A clearer view of today&apos;s work.</span>
                <span className={styles.previewButton}>＋ New Member</span>
                <span className={styles.previewButtonSecondary}>Manage Attendance</span>
              </div>
              <div className={styles.previewMetrics}>
                <div><span>Members</span><strong>—</strong><small>Member directory</small></div>
                <div><span>Attendance</span><strong>—</strong><small>Today&apos;s visits</small></div>
                <div><span>Payment claims</span><strong>—</strong><small>Awaiting review</small></div>
                <div><span>Staff</span><strong>—</strong><small>Workspace access</small></div>
              </div>
              <div className={styles.previewPanel}>
                <div className={styles.previewPanelHead}><strong>Today&apos;s attendance</strong><span>LIVE ACTIVITY</span></div>
                <div className={styles.previewActivity}><span className={styles.previewPerson}>A</span><span><b>Member check-in</b><small>Attendance record</small></span><i /></div>
                <div className={styles.previewActivity}><span className={styles.previewPerson}>M</span><span><b>Member directory</b><small>Plans and expiry dates</small></span><i /></div>
                <div className={styles.previewActivity}><span className={styles.previewPerson}>₹</span><span><b>Payment review</b><small>Claims awaiting verification</small></span><i /></div>
              </div>
            </div>
          </div>
        </div>
        <p className={styles.heroCaption}><span>BUILT FOR THE DAILY ROUTINE</span><span>ONE WORKSPACE · YOUR GYM</span></p>
      </section>

      <section className={styles.featuresSection} id="features">
        <div className={styles.sectionHeading}>
          <span className={styles.sectionEyebrow}>THE ESSENTIALS, MADE CLEAR</span>
          <h2>Everything important.<br /><span>Easy to find.</span></h2>
          <p>Practical tools for the everyday routines that keep a gym running.</p>
        </div>
        <div className={styles.featureGrid}>
          {features.map((feature) => (
            <article key={feature.number} className={styles.featureCard}>
              <div className={styles.featureCardTop}><span>{feature.number}</span><span className={styles.featureIcon + " " + styles[feature.tone]}>{feature.icon}</span></div>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
              <a href="#how-it-works" className={styles.learnLink}>Learn more <span aria-hidden="true">→</span></a>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.productSection} id="how-it-works">
        <div className={styles.sectionHeading}>
          <span className={styles.sectionEyebrow}>A FOCUSED WORKSPACE</span>
          <h2>Run your gym<br /><span>with more clarity.</span></h2>
          <p>Keep member details, daily attendance and payment verification connected without adding unnecessary complexity.</p>
        </div>
        <div className={styles.productGrid}>
          <article className={styles.productCard}>
            <div className={styles.productPreview}>
              <div className={styles.miniToolbar}><b>Members</b><span>⌕ Search members</span></div>
              <div className={styles.miniTableHead}><span>MEMBER</span><span>STATUS</span><span>PLAN</span></div>
              <div className={styles.miniTableRow}><span><i>A</i><b>Member profile</b></span><em>Active</em><span>Membership</span></div>
              <div className={styles.miniTableRow}><span><i>R</i><b>Member profile</b></span><em>Expiring</em><span>Membership</span></div>
            </div>
            <h3>Member directory</h3>
            <p>Find member records, membership status, expiry dates and outstanding balances.</p>
            <Link href="/sign-in" className={styles.learnLink}>Open workspace <span aria-hidden="true">→</span></Link>
          </article>
          <article className={styles.productCard}>
            <div className={styles.productPreview}>
              <div className={styles.miniToolbar}><b>Attendance</b><span>TODAY</span></div>
              <div className={styles.activityPreviewRow}><i>✓</i><span><b>Check-in record</b><small>Member visit recorded</small></span><em>In gym</em></div>
              <div className={styles.activityPreviewRow}><i>↗</i><span><b>Check-out record</b><small>Visit completed</small></span><em>Closed</em></div>
              <div className={styles.activityPreviewRow}><i>◷</i><span><b>Daily attendance</b><small>One view for today&apos;s activity</small></span></div>
            </div>
            <h3>Attendance overview</h3>
            <p>Review today&apos;s check-ins and close open visits from the gym workspace.</p>
            <Link href="/sign-in" className={styles.learnLink}>Open workspace <span aria-hidden="true">→</span></Link>
          </article>
          <article className={styles.productCard}>
            <div className={styles.productPreview}>
              <div className={styles.miniToolbar}><b>Payment review</b><span>QUEUE</span></div>
              <div className={styles.claimPreview}><span className={styles.claimAmount}>₹ —</span><span><b>Member payment claim</b><small>Awaiting gym verification</small></span><em>Pending</em></div>
              <div className={styles.claimProgress}><span /></div>
              <p className={styles.previewFootnote}>Claims are separate from confirmed payments.</p>
            </div>
            <h3>Payment verification</h3>
            <p>Review payment claims before recording them as confirmed payments.</p>
            <Link href="/sign-in" className={styles.learnLink}>Open workspace <span aria-hidden="true">→</span></Link>
          </article>
        </div>
      </section>

      <section className={styles.ctaSection}>
        <span className={styles.ctaGlyph} aria-hidden="true">💪</span>
        <h2>Ready to get started?</h2>
        <p>Bring your everyday gym operations into one clear workspace.</p>
        <div className={styles.heroActions}>
          <Link href="/sign-in" className={styles.primaryCta}>Get Started <span aria-hidden="true">↗</span></Link>
          <Link href="/sign-in" className={styles.secondaryCta}>Member / Staff Login</Link>
        </div>
      </section>

      <footer className={styles.footer}>
        <Link href="/" className={styles.footerBrand}><span className={styles.brandMark}>💪</span><strong>gym<span>saas</span></strong></Link>
        <div className={styles.footerLinks}><a href="#features">Features</a><a href="#workspace">Workspace</a><Link href="/sign-in">Login</Link><Link href="/api/health">Service health</Link></div>
        <span className={styles.footerNote}>Clear records. Confident decisions.</span>
      </footer>
    </main>
  );
}