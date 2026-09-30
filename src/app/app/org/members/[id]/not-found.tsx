import Link from "next/link";

import styles from "../members.module.css";

export default function MemberNotFound() {
  return (
    <main>
      <section className={styles.stateBox} aria-label="Member not found">
        <h2>Member not found</h2>
        <p>This member does not exist or you do not have access to it.</p>
        <div className={styles.stateActions}>
          <Link href="/app/org/members" className={styles.secondaryButton}>
            Back to members
          </Link>
        </div>
      </section>
    </main>
  );
}
