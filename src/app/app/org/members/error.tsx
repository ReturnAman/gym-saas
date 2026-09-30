"use client";

import Link from "next/link";

import styles from "./members.module.css";

export default function MembersError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main>
      <section className={styles.stateBox} aria-label="Members failed to load">
        <h2>Could not load members</h2>
        <p>Something went wrong while loading the members list. Please try again.</p>
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
