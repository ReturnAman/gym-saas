import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

import PaymentClaimsError from "./error";
import PaymentClaimsLoading from "./loading";

/** The section's loading and error states render their safe copy. */
describe("payment claims loading/error states", () => {
  it("loading announces what is being fetched", () => {
    const html = renderToString(<PaymentClaimsLoading />);
    expect(html).toContain("Loading payment claims…");
    expect(html).toContain('aria-label="Loading payment claims"');
  });

  it("error offers a retry and a way back without internal details", () => {
    const html = renderToString(
      <PaymentClaimsError error={new Error("boom")} reset={() => {}} />,
    );
    expect(html).toContain("Could not load payment claims");
    expect(html).toContain("Try again");
    expect(html).toContain("Back to gym");
    expect(html).not.toContain("boom");
  });
});
