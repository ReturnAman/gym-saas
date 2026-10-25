import Image from "next/image";
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
        <span>One platform for gyms and fitness studios. Each gets its own workspace.</span>
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
            <a href="#platform-model" className={styles.navLink}>For every gym</a>
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
          <p className={styles.eyebrow}><span /> MULTI-TENANT GYM MANAGEMENT SOFTWARE</p>
          <h1>One Platform.<br /><span>Every Gym.</span></h1>
          <p className={styles.heroCopy}>
            Manage members, attendance, payment reviews and staff access through one platform—while each gym works in its own workspace.
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
                <span className={styles.previewEyebrow}>YOUR GYM WORKSPACE</span>
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
        <p className={styles.heroCaption}><span>BUILT FOR GYM OPERATORS</span><span>EACH GYM · ITS OWN WORKSPACE</span></p>
      </section>

      <section className={styles.tenantStrip} aria-label="Who Gym SaaS is built for">
        <span className={styles.tenantStripLabel}>ONE PLATFORM</span>
        <span>Independent gyms</span>
        <i aria-hidden="true" />
        <span>Fitness studios</span>
        <i aria-hidden="true" />
        <span>Separate gym workspaces</span>
        <i aria-hidden="true" />
        <span>Member, attendance &amp; payment workflows</span>
      </section>

      <section className={styles.featuresSection} id="features">
        <div className={styles.sectionHeading}>
          <span className={styles.sectionEyebrow}>THE ESSENTIALS, MADE CLEAR</span>
          <h2>Everything important.<br /><span>Easy to find.</span></h2>
          <p>Core workflows for independent gyms and fitness studios, under one platform.</p>
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
          <h2>The tools behind<br /><span>everyday gym operations.</span></h2>
          <p>Each gym gets a focused workspace for its own member records, attendance and payment review—using one consistent management platform.</p>
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


      <section className={styles.mediaSection} id="platform-model">
        <div className={styles.mediaSectionHeader}>
          <span className={styles.sectionEyebrow}>BUILT FOR MANY GYMS, NOT JUST ONE</span>
          <h2>Different gyms.<br /><span>One management platform.</span></h2>
          <p>Gym SaaS is the software behind gym businesses—not a website for a single facility. Each gym has its own workspace for member records, attendance, payment review and staff access.</p>
        </div>
        <div className={styles.mediaGrid}>
          <article className={styles.mediaFeature}>
            <Image
              src="https://images.pexels.com/photos/7031706/pexels-photo-7031706.jpeg?auto=compress&cs=tinysrgb&w=1800"
              alt="Spacious modern gym interior with cardio and strength equipment"
              fill
              unoptimized
              sizes="(max-width: 720px) 100vw, 66vw"
              className={styles.mediaImage}
            />
            <div className={styles.mediaOverlay}>
              <span>ONE PLATFORM · SEPARATE WORKSPACES</span>
              <h3>Each gym gets its own place to manage the day.</h3>
            </div>
          </article>

          <article className={styles.mediaVideoCard}>
            <div className={styles.mediaVideoFrame}>
              <video
                controls
                playsInline
                preload="none"
                poster="https://images.pexels.com/photos/4164463/pexels-photo-4164463.jpeg?auto=compress&cs=tinysrgb&w=1000"
                aria-label="Video of gym weights and training equipment"
              >
                <source src="https://videos.pexels.com/video-files/6389051/6389051-uhd_3840_2160_25fps.mp4" type="video/mp4" />
                Your browser does not support embedded video.
              </video>
            </div>
            <div className={styles.mediaVideoCopy}>
              <span>MADE FOR GYM OPERATORS</span>
              <h3>Spend less time chasing everyday details.</h3>
            </div>
          </article>

          <article className={styles.mediaImageCard}>
            <Image
              src="https://images.pexels.com/photos/12250460/pexels-photo-12250460.jpeg?auto=compress&cs=tinysrgb&w=1000"
              alt="Rows of treadmills in a modern gym"
              fill
              unoptimized
              sizes="(max-width: 720px) 100vw, 33vw"
              className={styles.mediaImage}
            />
            <div className={styles.mediaOverlay}>
              <span>MEMBER MANAGEMENT</span>
              <h3>Keep member records organized.</h3>
            </div>
          </article>

          <article className={styles.mediaImageCard}>
            <Image
              src="https://images.pexels.com/photos/32610333/pexels-photo-32610333.jpeg?auto=compress&cs=tinysrgb&w=1000"
              alt="Medicine balls and gym training equipment on a rack"
              fill
              unoptimized
              sizes="(max-width: 720px) 100vw, 33vw"
              className={styles.mediaImage}
            />
            <div className={styles.mediaOverlay}>
              <span>ATTENDANCE & VISITS</span>
              <h3>Keep track of daily gym activity.</h3>
            </div>
          </article>

          <article className={styles.mediaPortraitCard}>
            <Image
              src="https://images.pexels.com/photos/4162485/pexels-photo-4162485.jpeg?auto=compress&cs=tinysrgb&w=1000"
              alt="Colour-coded weight plates in a strength-training area"
              fill
              unoptimized
              sizes="(max-width: 720px) 100vw, 33vw"
              className={styles.mediaImage}
            />
            <div className={styles.mediaOverlay}>
              <span>PAYMENT REVIEW</span>
              <h3>Know what needs verification.</h3>
            </div>
          </article>

          <article className={styles.mediaImageCard}>
            <Image
              src="https://images.pexels.com/photos/4164463/pexels-photo-4164463.jpeg?auto=compress&cs=tinysrgb&w=1000"
              alt="Rows of dumbbells in a strength training area"
              fill
              unoptimized
              sizes="(max-width: 720px) 100vw, 33vw"
              className={styles.mediaImage}
            />
            <div className={styles.mediaOverlay}>
              <span>STRENGTH TRAINING</span>
              <h3>A consistent workspace for each gym team.</h3>
            </div>
          </article>

          <article className={styles.mediaImageCard}>
            <Image
              src="https://images.pexels.com/photos/39647098/pexels-photo-39647098.jpeg?auto=compress&cs=tinysrgb&w=1000"
              alt="Athlete using strength-training equipment in a dimly lit gym"
              fill
              unoptimized
              sizes="(max-width: 720px) 100vw, 33vw"
              className={styles.mediaImage}
            />
            <div className={styles.mediaOverlay}>
              <span>YOUR GYM, YOUR WORKSPACE</span>
              <h3>Member data and staff access stay with the right gym.</h3>
            </div>
          </article>
        </div>
        <p className={styles.mediaFootnote}>The imagery illustrates different training environments; Gym SaaS is the management platform behind each gym.</p>
      </section>

      <section className={styles.ctaSection}>
        <span className={styles.ctaGlyph} aria-hidden="true">💪</span>
        <h2>Ready to manage your gym with more clarity?</h2>
        <p>Give your team one focused workspace for members, attendance and payment review.</p>
        <div className={styles.heroActions}>
          <Link href="/sign-in" className={styles.primaryCta}>Get Started <span aria-hidden="true">↗</span></Link>
          <Link href="/sign-in" className={styles.secondaryCta}>Member / Staff Login</Link>
        </div>
      </section>

      <footer className={styles.footer}>
        <Link href="/" className={styles.footerBrand}><span className={styles.brandMark}>💪</span><strong>gym<span>saas</span></strong></Link>
        <div className={styles.footerLinks}><a href="#features">Features</a><a href="#workspace">Workspace</a><a href="#platform-model">For every gym</a><Link href="/sign-in">Login</Link><Link href="/api/health">Service health</Link></div>
        <span className={styles.footerNote}>One platform. Separate gym workspaces.</span>
      </footer>
    </main>
  );
}