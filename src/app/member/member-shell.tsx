"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "./member-shell.module.css";

const links = [
  { href: "/member", label: "Home", icon: "⌂" },
  { href: "/member/attendance", label: "Attendance", icon: "◷" },
  { href: "/member/payments", label: "Payments", icon: "₹" },
  { href: "/member/scan", label: "Scan QR", icon: "⌗" },
];

export function MemberShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/member";
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link href="/member" className={styles.brand} aria-label="Gym SaaS member home">
          <span className={styles.brandMark} aria-hidden="true">💪</span>
          <span className={styles.brandCopy}>
            <strong>gym<span>saas</span></strong>
            <small>GYM MANAGEMENT</small>
          </span>
        </Link>
        <nav className={styles.desktopNav} aria-label="Member navigation">
          {links.map((link) => {
            const active = pathname === link.href ||
              (link.href === "/member/scan" && (pathname === "/member/check-in" || pathname === "/member/sign-in"));
            return (
              <Link
                key={link.href}
                href={link.href}
                className={[styles.navLink, active ? styles.navActive : ""].join(" ")}
                aria-current={active ? "page" : undefined}
              >
                <span className={styles.navIcon} aria-hidden="true">{link.icon}</span>
                {link.label}
              </Link>
            );
          })}
        </nav>
        <Link href="/member/scan" className={styles.headerAction}>Check in <span aria-hidden="true">↗</span></Link>
      </header>
      <div className={styles.content}>
        {children}
      </div>
      <footer className={styles.footer}>
        <span>GYMSAAS MEMBER SPACE</span>
        <span>Membership, attendance and payments in one place.</span>
      </footer>
      <nav className={styles.mobileNav} aria-label="Member navigation">
        {links.map((link) => {
          const active = pathname === link.href ||
            (link.href === "/member/scan" && (pathname === "/member/check-in" || pathname === "/member/sign-in"));
          return (
            <Link
              key={link.href}
              href={link.href}
              className={[styles.mobileLink, active ? styles.mobileActive : ""].join(" ")}
              aria-current={active ? "page" : undefined}
            >
              <span aria-hidden="true">{link.icon}</span>
              {link.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}