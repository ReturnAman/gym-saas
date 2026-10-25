# Gym SaaS UI — reference extraction

This file records the visible design evidence supplied in the goJim screenshots and the implementation boundaries for Gym SaaS. It is a screenshot-derived design translation, not a claim that the original source CSS, font files, assets, or responsive rules were recovered.

## What the screenshots show

### Marketing site
1. A full-width acid-lime announcement strip above the site.
2. A floating/inset white navigation capsule with a compact rounded-square brand mark, horizontal centered navigation, an outlined secondary action, and a lime primary action.
3. A centered hero on a near-black canvas. The heading is large, bold, tightly tracked, and uses a white-to-gray text gradient. Supporting text is narrow and centered; the primary CTA is lime with a soft glow.
4. A dark browser-frame preview of the product with browser chrome, a centered app navigation capsule, near-black panels, restrained outlines, metric cards, and compact activity rows.
5. Four-column feature tiles with subdued dark-green/brown/blue surfaces and lime, warm-yellow, cyan, and orange icon blocks.
6. Large product cards, followed by a centered CTA and multi-column footer. The supplied reference also shows trainer cards, workout categories, testimonials, pricing, and a fitness-photo collage.

### Product workspace
1. Near-black background, no large bright sidebar.
2. Brand at the top-left; horizontal rounded dark navigation centered near the top.
3. The selected navigation item is a white capsule with dark text; inactive items are gray on charcoal.
4. Main content sits in a broad, centered container with generous margins.
5. Welcome/title region is left-aligned. Metrics sit in compact 2-by-2 cards. Additional operational panels use near-black fills, fine gray outlines, white headings, muted labels, and restrained lime accents.
6. Tables are dark and compact, with low-contrast separators, uppercase muted column labels, and pill-shaped status indicators.

## Screenshot-derived visual tokens

These are approximate CSS token values sampled from the supplied raster screenshots. Anti-aliasing, compression, and display scaling mean they should not be treated as the original design's exact source values.

| Token | Value | Evidence |
|---|---|---|
| Canvas | \`#050505\` | Dominant marketing and app background pixels |
| Main text | \`#F5F5F5\` | Main headings and primary labels |
| Secondary text | \`#A4A4A4\` | Body copy and inactive labels |
| Quiet text | \`#777777\` | Metadata and table headings |
| Panel | \`#0B0B0B\` | Cards and dashboard surfaces |
| Raised panel | \`#11120C\` | Subtle green-tinted cards |
| Border | \`#262626\` | Card/table separators |
| Lime accent | \`#B8F175\` | Announcement bar and primary CTA (sampled from screenshot) |
| Warm accent | \`#FF9B65\` | Orange icon tile |
| Yellow accent | \`#F2DF76\` | Yellow icon tile |
| Cyan accent | \`#76D4E7\` | Blue/cyan icon tile |
| Active tab | \`#F5F5F5\` | Selected workspace navigation pill |

## Component rules inferred from visible screens

- Typography: system sans / Inter-like appearance; oversized hero headings, tight negative tracking, medium-to-bold weights, muted supporting copy.
- Marketing navigation: white capsule, approximately 16 px corner radius, dark text, lime primary action.
- Workspace navigation: charcoal capsule, pill tabs, white active tab.
- Buttons: lime fill and dark text for the primary action; charcoal/transparent with a fine outline for secondary actions.
- Cards: black or near-black fills, 1 px muted outlines, rounded corners around 14–17 px, no prominent drop shadows.
- Statuses: compact rounded pills with both color and text; reserve green for success, amber for pending/attention, and red for failure/due.
- Responsive behavior is not directly proven by the desktop screenshots. Current breakpoints are adaptations for usability, not recovered original breakpoints.

## Existing application routes mapped to the visual system

The design is applied to existing, implemented product capabilities: overview, member list/detail and forms, attendance and QR, payment claim review, join requests, staff access, settings, sign-in/onboarding, and member-facing attendance/payment pages.

The screenshots do not establish that Gym SaaS has trainer discovery, workout categories, class scheduling, testimonials, or defined pricing. Those visual elements must not be presented as live product features or real customer evidence unless the product owner supplies the actual feature scope and copy. The reference's layout language can be reused without making those claims.

## Fidelity boundary

A true 100% pixel match cannot be verified from these raster screenshots alone. The original source, exact fonts, icon files, photography, interaction states, device breakpoints, and motion settings were not provided; the reference URLs were not accessible to the browser fetch in this environment. This implementation therefore targets a close visual reproduction of the visible layouts and style tokens, while keeping real Gym SaaS data, route behavior, permission checks, and launch-critical accuracy. Any component not shown is styled using these tokens rather than being claimed as an exact recovered design.
