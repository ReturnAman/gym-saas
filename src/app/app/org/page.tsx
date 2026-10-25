import Link from "next/link";

import { formatInr, MEMBERSHIP_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/members";
import { listTodayAttendance, canViewAttendance } from "@/lib/server/attendance";
import { listMembers, getMemberPermissions } from "@/lib/server/members";
import { canViewJoinRequests, listPendingJoinRequests } from "@/lib/server/member-join-requests";
import { requireOrganizationContext } from "@/lib/server/authorization";
import { formatKolkataTime } from "@/lib/attendance";

import styles from "./dashboard.module.css";

function greetingTime(): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(new Date()));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase() || "M";
}

export default async function OrganizationPage() {
  const { user, membership, organization } = await requireOrganizationContext();
  const memberPermissions = getMemberPermissions(membership.role);
  const canSeeAttendance = canViewAttendance(membership.role);
  const canSeeJoinRequests = canViewJoinRequests(membership.role);
  const [membersResult, sessions, joinRequests] = await Promise.all([
    listMembers(user.id, { page: 1, pageSize: 5 }),
    canSeeAttendance ? listTodayAttendance(user.id) : Promise.resolve([]),
    canSeeJoinRequests ? listPendingJoinRequests(user.id) : Promise.resolve(null),
  ]);

  const todayLabel = new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Kolkata",
  }).format(new Date());
  const checkInCount = sessions.length;
  const openCount = sessions.filter((session) => session.checkOutAt === null).length;
  const isMemberRole = membership.role === "MEMBER";

  const quickActions = [
    ...(memberPermissions.canCreate ? [{ href: "/app/org/members/new", icon: "+", title: "Add a member", description: "Create a profile and membership" }] : []),
    ...(canSeeAttendance ? [{ href: "/app/org/attendance", icon: "↗", title: "Take attendance", description: "Check in a member or close a visit" }] : []),
    ...(canSeeJoinRequests ? [{ href: "/app/org/join-requests", icon: "✓", title: "Review join requests", description: "Approve or reject member requests" }] : []),
    ...(membership.role === "OWNER" || membership.role === "ADMIN" || membership.role === "STAFF" ? [{ href: "/app/org/payment-claims", icon: "₹", title: "Verify a payment", description: "Review claims before confirming payment" }] : []),
  ];

  return (
    <main className={styles.dashboard}>
      <section className={styles.welcome}>
        <div className={styles.welcomeCopy}>
          <div className={styles.eyebrow}><span className={styles.eyebrowDot} /> YOUR GYM, IN RHYTHM</div>
          <h1>{greetingTime()}, {organization.name}.</h1>
          <p>Here is the pulse of your gym today. Keep the small things organised and the big things moving.</p>
          <div className={styles.welcomeMeta}><span className={styles.calendarIcon}>▦</span>{todayLabel}<span className={styles.metaDivider} />{membership.role.charAt(0) + membership.role.slice(1).toLowerCase()} workspace</div>
        </div>
        <div className={styles.welcomeArtwork} aria-hidden="true">
          <div className={styles.artCircleOne} />
          <div className={styles.artCircleTwo} />
          <div className={styles.artOrbit} />
          <div className={styles.artMonogram}>G<span>.</span></div>
          <span className={styles.artCaption}>SHOW UP<br />MOVE FORWARD</span>
        </div>
      </section>

      <section className={styles.metricGrid} aria-label="Gym overview">
        <article className={styles.metricCard}>
          <div className={styles.metricTop}><span className={styles.metricIcon + " " + styles.membersIcon}>♙</span><span className={styles.metricOverline}>MEMBERS</span></div>
          <strong className={styles.metricValue}>{membersResult.total.toLocaleString("en-IN")}</strong>
          <span className={styles.metricDescription}>{isMemberRole ? "Your linked member record" : "Member profiles in your gym"}</span>
          <Link href="/app/org/members" className={styles.metricLink}>View members <span>→</span></Link>
        </article>
        <article className={styles.metricCard}>
          <div className={styles.metricTop}><span className={styles.metricIcon + " " + styles.attendanceIcon}>↗</span><span className={styles.metricOverline}>ATTENDANCE</span></div>
          <strong className={styles.metricValue}>{canSeeAttendance ? checkInCount.toLocaleString("en-IN") : "—"}</strong>
          <span className={styles.metricDescription}>{canSeeAttendance ? "Check-ins recorded today" : "Not available for your role"}</span>
          {canSeeAttendance && <Link href="/app/org/attendance" className={styles.metricLink}>Open attendance <span>→</span></Link>}
        </article>
        <article className={styles.metricCard}>
          <div className={styles.metricTop}><span className={styles.metricIcon + " " + styles.openIcon}>◷</span><span className={styles.metricOverline}>CURRENTLY IN GYM</span></div>
          <strong className={styles.metricValue}>{canSeeAttendance ? openCount.toLocaleString("en-IN") : "—"}</strong>
          <span className={styles.metricDescription}>{canSeeAttendance ? "Visits waiting for check-out" : "Not available for your role"}</span>
          {canSeeAttendance && <Link href="/app/org/attendance" className={styles.metricLink}>See today&apos;s visits <span>→</span></Link>}
        </article>
        <article className={styles.metricCard + " " + styles.metricHighlighted}>
          <div className={styles.metricTop}><span className={styles.metricIcon + " " + styles.requestsIcon}>✳</span><span className={styles.metricOverline}>JOIN REQUESTS</span></div>
          <strong className={styles.metricValue}>{joinRequests ? joinRequests.totalPending.toLocaleString("en-IN") : "—"}</strong>
          <span className={styles.metricDescription}>{joinRequests ? "Waiting for a staff decision" : "Queue not available for your role"}</span>
          {joinRequests && <Link href="/app/org/join-requests" className={styles.metricLink}>Review requests <span>→</span></Link>}
        </article>
      </section>

      <section className={styles.middleGrid}>
        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div><span className={styles.sectionEyebrow}>LIVE ACTIVITY</span><h2>Today&apos;s attendance</h2><p>Member visits recorded for your gym today.</p></div>
            {canSeeAttendance && <Link href="/app/org/attendance" className={styles.panelLink}>View all <span>→</span></Link>}
          </div>
          {!canSeeAttendance || sessions.length === 0 ? (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}>◷</span>
              <strong>{canSeeAttendance ? "A fresh start to the day" : "Attendance overview"}</strong>
              <p>{canSeeAttendance ? "No check-ins have been recorded today yet. Your first visit will show up here." : "Attendance details are limited to staff and trainers."}</p>
              {canSeeAttendance && <Link href="/app/org/attendance">Open attendance <span>→</span></Link>}
            </div>
          ) : (
            <div className={styles.activityList}>
              {sessions.slice(0, 5).map((session) => (
                <div key={session.id} className={styles.activityRow}>
                  <span className={styles.memberAvatar}>{initials(session.memberName)}</span>
                  <span className={styles.activityMember}><strong>{session.memberName}</strong><small>Checked in at {formatKolkataTime(new Date(session.checkInAt))}</small></span>
                  <span className={session.checkOutAt === null ? styles.statusOpen : styles.statusClosed}>{session.checkOutAt === null ? "In gym" : "Checked out"}</span>
                </div>
              ))}
            </div>
          )}
          {sessions.length > 5 && canSeeAttendance && <div className={styles.panelFootnote}>Showing the latest 5 of {sessions.length} check-ins.</div>}
        </article>

        <article className={styles.panel + " " + styles.actionsPanel}>
          <div className={styles.panelHeader}>
            <div><span className={styles.sectionEyebrow}>QUICK ACCESS</span><h2>Get things moving</h2><p>Shortcuts for the work that matters today.</p></div>
          </div>
          {quickActions.length > 0 ? (
            <div className={styles.actionList}>
              {quickActions.map((action) => (
                <Link href={action.href} key={action.href} className={styles.actionRow}>
                  <span className={styles.actionIcon}>{action.icon}</span>
                  <span className={styles.actionCopy}><strong>{action.title}</strong><small>{action.description}</small></span>
                  <span className={styles.actionArrow}>↗</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}><strong>You&apos;re all set</strong><p>Your available workspace shortcuts will appear here.</p></div>
          )}
        </article>
      </section>

      <section className={styles.panel + " " + styles.membersPanel}>
        <div className={styles.panelHeader}>
          <div><span className={styles.sectionEyebrow}>MEMBER DIRECTORY</span><h2>{isMemberRole ? "Your member profile" : "Recently added members"}</h2><p>{isMemberRole ? "Your linked gym member details." : "A quick look at the latest profiles added to your gym."}</p></div>
          <Link href="/app/org/members" className={styles.panelLink}>{isMemberRole ? "Open profile" : "View directory"} <span>→</span></Link>
        </div>
        {membersResult.items.length === 0 ? (
          <div className={styles.memberEmpty}>
            <span className={styles.emptyIcon}>♙</span>
            <div><strong>No member profiles yet</strong><p>Add your first member to start keeping plans, attendance and payments organised.</p></div>
            {memberPermissions.canCreate && <Link href="/app/org/members/new" className={styles.tableAction}>Add a member <span>+</span></Link>}
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.membersTable}>
              <thead><tr><th>MEMBER</th><th>MEMBERSHIP</th><th>EXPIRY DATE</th><th>PAYMENT STATUS</th><th>OUTSTANDING</th><th /></tr></thead>
              <tbody>
                {membersResult.items.map((member) => (
                  <tr key={member.id}>
                    <td><span className={styles.tableMember}><span className={styles.tableAvatar}>{initials(member.name)}</span><span><strong>{member.name}</strong><small>{member.phoneNumber}</small></span></span></td>
                    <td>{member.planLabel || <span className={styles.mutedValue}>No membership</span>}{member.membershipStatus && <small className={styles.subCell}>{MEMBERSHIP_STATUS_LABELS[member.membershipStatus]}</small>}</td>
                    <td>{member.expiryDate ? member.expiryDate.split("-").reverse().join("/") : "—"}</td>
                    <td>{member.paymentStatus ? <span className={member.paymentStatus === "PAID" ? styles.statusPaid : member.paymentStatus === "UNPAID" ? styles.statusDue : styles.statusPartial}>{PAYMENT_STATUS_LABELS[member.paymentStatus]}</span> : "—"}</td>
                    <td className={styles.outstanding}>{member.outstandingPaise === null ? "—" : formatInr(member.outstandingPaise)}</td>
                    <td><Link href={"/app/org/members/" + member.id} className={styles.rowArrow} aria-label={"Open " + member.name}>↗</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!isMemberRole && membersResult.total > membersResult.items.length && <div className={styles.tableFooter}><span>Showing {membersResult.items.length} of {membersResult.total.toLocaleString("en-IN")} member profiles</span><Link href="/app/org/members">View all members →</Link></div>}
      </section>
    </main>
  );
}
