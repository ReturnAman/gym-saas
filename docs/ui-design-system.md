# Gym SaaS UI Design System — Locked

**Status: approved visual direction. Do not redesign without explicit owner approval.**

This is the persistent design contract for every current and future screen, including owner/staff workspaces, member experience, onboarding, authentication, settings, forms, dialogs, loading/empty/error states, and future features.

## Product identity

Gym SaaS is multi-tenant gym management software. It is **not** a website for a single gym. Marketing imagery is illustrative fitness context; copy and layout must explain the software platform and the fact that each gym has its own workspace. Do not imply that pictured facilities, trainers or members are actual Gym SaaS customers or staff.

## Core tokens

| Token | CSS variable / canonical value | Use |
|---|---|---|
| Canvas | `--canvas` `#050505` | Page/app background |
| Panel | `--surface` `#0B0B0B` | Main cards and panels |
| Raised panel | `--surface-soft` `#11120E` | Interactive cards, previews |
| Border | `--line` `#262626` | Fine outlines and separators |
| Primary text | `--ink` `#F5F5F5` | Headings and important labels |
| Supporting text | `--ink-soft` `#B5B5B5` | Body/supporting copy |
| Quiet text | `--muted` `#8B8B8B` | Metadata and table labels |
| Primary accent | `--lime` `#B8F175` | Main actions, active accents |
| Success | `--green` `#70E2A8` on `--green-soft` `#10251A` | Confirmed success only |
| Attention | `--amber` `#F4C65B` on `--amber-soft` `#29220E` | Pending/attention |
| Error/due | `--red` `#FF857B` on `--red-soft` `#2A1412` | Errors or due/failed states |

### Supporting tokens

Also implemented on `:root` in `src/app/globals.css`. These support
the primary tokens above rather than carrying their own surfaces;
like the primary tokens, they are consumed by the surface slices.

| Token | CSS variable / canonical value | Use |
|---|---|---|
| Forest | `--forest` `#141A10` | Deep green-tinted surface for feature/product cards |
| Forest deep | `--forest-deep` `#050505` | Dark end of forest surfaces and gradients (same value as canvas) |
| Lime deep | `--lime-deep` `#A6E65C` | Deeper lime for accent gradients and pressed/hover depth on lime elements |
| Soft shadow | `--shadow-soft` `0 18px 48px rgba(0, 0, 0, 0.32)` | The system's single soft elevation shadow, reserved for raised previews and overlays; panels otherwise stay flat with borders |

Together, the two tables above account for all 18 custom properties
defined in `src/app/globals.css`.

### Implemented tokens vs reference-only colors

The table above is canonical: its values are exactly the custom
properties implemented on `:root` in `src/app/globals.css` (hex case
aside). `docs/reference-ui-spec.md` records colors sampled from the
reference screenshots; sampling is approximate, so where a sampled
value differs from a token above — sampled `#A4A4A4`, `#777777`,
`#83E3A7`, `#F2D16F`, `#FF9087`, `#11120C` — the token in this table
wins and the sampled value is reference-only evidence, not a token.
Also reference-only, with no implemented token: the feature-tile
accents sampled in the reference spec (`#FF9B65`, `#F2DF76`,
`#76D4E7`) and the `#101010` form-control fill used by the Stage 0
branch's deferred shell layer. Do not introduce new colors from the
reference-only list without an approved token change.

## Layout and components

- Use the existing Inter-like system sans stack, tight heading tracking, strong short headings, and muted support copy.
- Marketing site: black/lime announcement strip, inset white rounded navigation capsule, dark hero, oversized white-to-gray headline, lime CTA, browser-frame product preview, restrained feature/product cards, and editorial supporting imagery.
- Authenticated workspace: dark canvas, brand at the top-left, centered charcoal pill navigation, white active navigation pill, right-side profile controls, broad centered content, compact metric cards, near-black operational panels, muted table headings, low-contrast separators, and compact status pills.
- Member area: use the same black/lime palette, typography, borders, radii, controls, and mobile navigation. It is a role-specific view of the same product, not a separate brand or marketing page.
- Primary button: lime fill with dark text. Secondary button: transparent/charcoal surface and fine border. Focus rings use lime with visible contrast.
- Typical cards/panels use 14–17px radii, 1px subtle borders and restrained/no shadows. Do not introduce a second design language, new palette, bright dashboard sidebar, unrelated gradients, or ad-hoc card styles.
- Preserve mobile layouts, keyboard focus, semantic headings/labels, and reduced-motion support.
- Use existing components and CSS modules as the first option. Put new shared tokens/components in established shared files when repetition is real; avoid duplicating slightly different button/nav/card designs screen-by-screen.

## Content rules

Use natural, helpful copy that speaks to gym owners' everyday work. Examples: “Keep member records, attendance and payment follow-ups in one place.” Avoid generic filler. Do not claim features that are not implemented.
The product is multi-tenant: the public page explains one platform for many gyms and separate workspaces. App launch must send authenticated users directly to their role-specific area, not repeatedly show the marketing homepage.
Do not advertise a “7-day free trial” as live until trial start, duration, expiration behavior and the manual subscription/renewal path are implemented and tested.

## Before adding a screen

1. Read this file and `docs/reference-ui-spec.md`.
2. Find the closest existing screen and reuse its structure/tokens.
3. Keep the change scoped to the new capability; do not opportunistically redesign unrelated pages.
4. Include loading, empty, error, success and permission-denied states as applicable, all within this system.
5. Check desktop and mobile; add tests for behavior and verify the production build.
6. Update this document only when an explicitly approved change changes the system; record the change and rationale rather than silently diverging.

## Current supporting documentation

- Screenshot extraction and fidelity boundaries: `docs/reference-ui-spec.md`
- Fitness media hosting and usage notes: `docs/ui-media-integration.md`

## Integration status on main (Phase 14B, base `981f67c`)

This design system was developed on the Stage 0 branch
(`chore/railway-stage0-readiness`, PR #3) and is being ported to main in
slices on `integration/*` branches. It is the approved visual reference
for that port. The proposed `AGENTS.md` mandate that accompanied it on
the Stage 0 branch has **not** been adopted; that requires separate
owner approval.

Applied in the foundation slice (`src/app/globals.css`):

- The complete token set above, as CSS custom properties on `:root`.
- Typography foundation: the design font stack, 15px base size,
  1.55 line height, antialiased rendering.
- Base rules: `box-sizing: border-box`, form controls inheriting the
  document font, pointer cursors for buttons, tap-highlight removal,
  placeholder color, overflow-wrap for headings/paragraphs, the lime
  selection treatment, and the reduced-motion block.

Deliberately deferred to the surface slices (landing/sign-in, PWA
entry, workspace shell, member shell), where each surface is restyled
and reviewed as a unit:

- The dark shell: near-black canvas, `color-scheme: dark`, dark
  form-control colors, heading ink color and letter-spacing, the
  global link color and `:focus-visible` lime outline.
- The main-element reset and the unclassed-`<main>` fallback layer.

Reason: on current main every screen renders a bare `<main>` styled by
scheme-adaptive (`light-dark`) CSS modules or by the interim shell
(body padding, 42rem centered main, both preserved unchanged in this
slice). Flipping the shell first would re-theme platform-admin, the
owner subscription page, and the member surfaces — none of which were
part of the reference design — without review, and would stretch every
layout from the 42rem column to full width. The interim shell is
marked as such in `globals.css` and is replaced slice by slice.

Also not yet ported: the media gallery placement described in
`docs/ui-media-integration.md` and the `images.pexels.com` remote
pattern in `next.config.ts`; both arrive with the landing slice.
