import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

const PAGE = read("src/app/app/subscription/page.tsx");

/**
 * Subscription page billing visibility (Phase 3 fix 2): the page stays
 * reachable by every member of a restricted gym (it is the recovery
 * screen), but billing details — the latest verified payment and the
 * operator-entered suspension reason — render only for the gym's
 * owner. Other roles see the state and the recovery text, never
 * amounts or operator notes.
 */
describe("subscription page billing visibility", () => {
  it("renders the latest verified payment only for the owner", () => {
    expect(PAGE).toMatch(/isOwner && latestPayment/);
  });

  it("renders the suspension reason only for the owner", () => {
    expect(PAGE).toMatch(/isOwner && subscription\?\.suspensionReason/);
  });

  it("still renders the subscription state for every role", () => {
    expect(PAGE).toMatch(/<h1>Subscription<\/h1>/);
    expect(PAGE).toMatch(/STATE_LABELS\[state\]/);
  });
});
