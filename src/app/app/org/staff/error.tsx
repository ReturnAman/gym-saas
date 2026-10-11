"use client";

import Link from "next/link";

import styles from "./staff.module.css";

export default function StaffError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main>
      <section className={styles.stateBox} aria-label="Staff failed to load">
        <h2>Could not load staff</h2>
        <p>
          Something went wrong while loading the staff list. Please try
          again.
        </p>
        <div className={styles.stateActions}>
          <button type="button" onClick={reset} className={styles.button}>
            Try again
          </button>
          <Link href="/app/org" className={styles.secondaryButton}>
            Back to gym
          </Link>
        </div>
      </section>
    </main>
  );
}
