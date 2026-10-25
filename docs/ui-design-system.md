# Gym SaaS UI Design System — Locked

**Status: approved visual direction. Do not redesign without explicit owner approval.**

This is the persistent design contract for every current and future screen, including owner/staff workspaces, member experience, onboarding, authentication, settings, forms, dialogs, loading/empty/error states, and future features.

## Product identity

Gym SaaS is multi-tenant gym management software. It is **not** a website for a single gym. Marketing imagery is illustrative fitness context; copy and layout must explain the software platform and the fact that each gym has its own workspace. Do not imply that pictured facilities, trainers or members are actual Gym SaaS customers or staff.

## Core tokens

| Token | Locked value | Use |
|---|---|---|
| Canvas | `#050505` | Page/app background |
| Panel | `#0B0B0B` | Main cards and panels |
| Raised panel | `#101010` / subtle green-tinted `#11120C` | Interactive cards, previews |
| Border | `#262626` | Fine outlines and separators |
| Primary text | `#F5F5F5` | Headings and important labels |
| Supporting text | `#A4A4A4` | Body/supporting copy |
| Quiet text | `#777777` | Metadata and table labels |
| Primary accent | `#B8F175` | Main actions, active accents |
| Success | `#83E3A7` / dark green background | Confirmed success only |
| Attention | `#F2D16F` / dark amber background | Pending/attention |
| Error/due | `#FF9087` / dark red background | Errors or due/failed states |

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
