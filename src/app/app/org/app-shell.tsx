"use client";

import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { usePathname } from "next/navigation";

import styles from "./app-shell.module.css";

interface AppShellProps {
  children: React.ReactNode;
  organizationName: string;
  role: string;
}

const navItems = [
  { href: "/app/org", label: "Overview", icon: "overview" },
  { href: "/app/org/members", label: "Members", icon: "members" },
  { href: "/app/org/attendance", label: "Attendance", icon: "attendance" },
  { href: "/app/org/payment-claims", label: "Payment review", icon: "payments", roles: ["OWNER", "ADMIN", "STAFF"] },
  { href: "/app/org/join-requests", label: "Join requests", icon: "joins", roles: ["OWNER", "ADMIN", "STAFF"] },
  { href: "/app/org/staff", label: "Staff", icon: "staff", roles: ["OWNER", "ADMIN"] },
  { href: "/app/org/settings", label: "Gym settings", icon: "settings" },
];

const pageNames: Record<string, string> = {
  "/app/org": "Overview",
  "/app/org/members": "Members",
  "/app/org/attendance": "Attendance",
  "/app/org/payment-claims": "Payment review",
  "/app/org/join-requests": "Join requests",
  "/app/org/staff": "Staff",
  "/app/org/settings": "Gym settings",
};

function Icon({ name }: { name: string }) {
  const common = { width: 19, height: 19, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  switch (name) {
    case "overview":
      return <svg {...common}><rect x="3.5" y="3.5" width="7" height="7" rx="1.6" /><rect x="13.5" y="3.5" width="7" height="4.5" rx="1.6" /><rect x="13.5" y="10.5" width="7" height="10" rx="1.6" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.6" /></svg>;
    case "members":
      return <svg {...common}><circle cx="9" cy="8" r="3.1" /><path d="M3.5 20v-1.8a5.5 5.5 0 0 1 11 0V20" /><path d="M16 5.2a3.1 3.1 0 0 1 0 5.9M18 14.8a4.8 4.8 0 0 1 2.5 4.2V20" /></svg>;
    case "attendance":
      return <svg {...common}><rect x="3.5" y="5" width="17" height="15.5" rx="2.2" /><path d="M7.5 3.5v3M16.5 3.5v3M3.5 9.5h17M7.5 14l2.5 2.5 5-5" /></svg>;
    case "payments":
      return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2.2" /><path d="M3 9.5h18M7 14.5h3M16.5 14.5h.1" /></svg>;
    case "joins":
      return <svg {...common}><circle cx="9" cy="8" r="3" /><path d="M3.5 20v-1.6a5.5 5.5 0 0 1 11 0V20M18 8v6M15 11h6" /></svg>;
    case "staff":
      return <svg {...common}><circle cx="12" cy="8" r="3.2" /><path d="M5 20v-1.8a7 7 0 0 1 14 0V20M4 4.5l1.4 1.4M20 4.5l-1.4 1.4" /></svg>;
    case "settings":
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 3.1-.2-.1a1.7 1.7 0 0 0-1.8.1 1.7 1.7 0 0 0-.8 1.5v.2H8.8v-.2a1.7 1.7 0 0 0-.8-1.5 1.7 1.7 0 0 0-1.8-.1l-.2.1-1.8-3.1.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-.9h-.2v-3.6h.2a1.7 1.7 0 0 0 1.5-.9 1.7 1.7 0 0 0-.3-1.9l-.1-.1 1.8-3.1.2.1a1.7 1.7 0 0 0 1.8-.1 1.7 1.7 0 0 0 .8-1.5v-.2h6.4v.2a1.7 1.7 0 0 0 .8 1.5 1.7 1.7 0 0 0 1.8.1l.2-.1 1.8 3.1-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5.9h.2v3.6h-.2a1.7 1.7 0 0 0-1.5.9Z" transform="translate(0 -1)" /></svg>;
    default:
      return <svg {...common}><circle cx="12" cy="12" r="8" /></svg>;
  }
}

function NavLinks({ role, pathname, mobile = false }: { role: string; pathname: string; mobile?: boolean }) {
  const visibleItems = navItems.filter((item) => !item.roles || item.roles.includes(role));
  return (
    <>
      {visibleItems.map((item) => {
        const active = pathname === item.href || (item.href !== "/app/org" && pathname.startsWith(item.href + "/"));
        return (
          <Link
            key={item.href}
            href={item.href}
            className={[mobile ? styles.mobileNavLink : styles.navLink, active ? (mobile ? styles.mobileNavActive : styles.navActive) : ""].join(" ")}
            aria-current={active ? "page" : undefined}
            title={item.label}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
            {!mobile && active && <span className={styles.activeMarker} />}
          </Link>
        );
      })}
    </>
  );
}

export function AppShell({ children, organizationName, role }: AppShellProps) {
  const pathname = usePathname() || "/app/org";
  const visibleItems = navItems.filter((item) => !item.roles || item.roles.includes(role));
  const activePage = [...visibleItems].reverse().find((item) => pathname === item.href || (item.href !== "/app/org" && pathname.startsWith(item.href + "/")));
  const title = activePage?.label || pageNames[pathname] || "Workspace";
  const initials = organizationName.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase() || "G";
  const roleLabel = role.charAt(0) + role.slice(1).toLowerCase();

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link href="/app/org" className={styles.brand}>
          <span className={styles.brandMark}>G</span>
          <span className={styles.brandText}><strong>gymsaas</strong><small>GYM OPERATIONS</small></span>
        </Link>

        <div className={styles.workspaceCard}>
          <span className={styles.workspaceAvatar}>{initials}</span>
          <span className={styles.workspaceCopy}><small>YOUR WORKSPACE</small><strong>{organizationName}</strong><span>{roleLabel} access</span></span>
          <span className={styles.workspaceChevron} aria-hidden="true">⌄</span>
        </div>

        <div className={styles.navLabel}>WORKSPACE</div>
        <nav className={styles.sidebarNav} aria-label="Workspace navigation">
          <NavLinks role={role} pathname={pathname} />
        </nav>

        <div className={styles.sidebarBottom}>
          <div className={styles.sidebarNote}>
            <span className={styles.noteGlyph}>✦</span>
            <strong>Keep the day moving.</strong>
            <p>Member records, attendance and payments — together in one place.</p>
            <Link href="/app/org/members">Explore members <span aria-hidden="true">→</span></Link>
          </div>
          <div className={styles.accountRow}>
            <span className={styles.accountAvatar}>{initials}</span>
            <span className={styles.accountCopy}><strong>{organizationName}</strong><small>{roleLabel}</small></span>
            <UserButton />
          </div>
        </div>
      </aside>

      <div className={styles.mainColumn}>
        <header className={styles.topbar}>
          <div className={styles.breadcrumbs}><span>WORKSPACE</span><b>/</b><strong>{title}</strong></div>
          <div className={styles.topbarRight}>
            <span className={styles.topbarDate}>{new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date())}</span>
            <span className={styles.topbarDivider} />
            <span className={styles.accountLabel}><span className={styles.onlineDot} /> {roleLabel}</span>
            <span className={styles.mobileUser}><UserButton /></span>
          </div>
        </header>
        <div className={styles.pageArea}>{children}</div>
        <footer className={styles.mainFooter}><span>GYMSAAS WORKSPACE</span><span>Clear records. Confident decisions.</span></footer>
      </div>

      <nav className={styles.mobileNav} aria-label="Mobile workspace navigation">
        <NavLinks role={role} pathname={pathname} mobile />
      </nav>
    </div>
  );
}
