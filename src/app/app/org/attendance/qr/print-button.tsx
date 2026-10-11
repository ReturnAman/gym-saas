"use client";

import styles from "../attendance.module.css";

/**
 * Print trigger for the gym QR poster. Printing is a browser action, so
 * it lives in this tiny client component; the poster itself (including
 * the QR code) is rendered entirely on the server. The print stylesheet
 * in attendance.module.css hides this button (and the other controls)
 * on paper, leaving only gym name, QR code, caption, and the URL.
 */
export function PrintButton() {
  return (
    <button type="button" className={styles.button} onClick={() => window.print()}>
      Print this poster
    </button>
  );
}
