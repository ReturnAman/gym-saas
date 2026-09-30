"use client";

import Link from "next/link";
import { useRef } from "react";

import styles from "./members.module.css";

/**
 * "Add Members" entry point: the three finalized ways to bring members in.
 * Import and WhatsApp are UX entry points only in this slice — they are
 * shown as clearly unavailable, not as fake functionality.
 */
export function AddMembersChoice() {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        className={styles.button}
        onClick={() => dialogRef.current?.showModal()}
      >
        Add Members
      </button>
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby="add-members-title"
      >
        <h2 id="add-members-title">Add members</h2>
        <p>Choose how to bring members into the gym.</p>
        <div className={styles.choiceList}>
          <Link href="/app/org/members/new" className={styles.choice}>
            <span className={styles.choiceText}>
              <span className={styles.choiceTitle}>Add manually</span>
              <span className={styles.choiceHint}>
                For new members and individual records
              </span>
            </span>
          </Link>
          <button type="button" className={styles.choice} disabled>
            <span className={styles.choiceText}>
              <span className={styles.choiceTitle}>
                Import existing members
                <span className={styles.comingSoon}>Coming soon</span>
              </span>
              <span className={styles.choiceHint}>
                From Excel, CSV, photos, or PDFs
              </span>
            </span>
          </button>
          <button type="button" className={styles.choice} disabled>
            <span className={styles.choiceText}>
              <span className={styles.choiceTitle}>
                Send on WhatsApp
                <span className={styles.comingSoon}>Coming soon</span>
              </span>
              <span className={styles.choiceHint}>
                Send your member records on WhatsApp
              </span>
            </span>
          </button>
        </div>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => dialogRef.current?.close()}
        >
          Close
        </button>
      </dialog>
    </>
  );
}
