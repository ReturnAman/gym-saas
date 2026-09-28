# Changelog

All notable changes to this project are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added
- Initial repository scaffold: documentation suite (`docs/00`–`docs/20`),
  agent operating manual (`AGENTS.md`), AI context (`AI_CONTEXT.md`), CI
  workflow, and issue/PR templates.
- Application foundation: Next.js 16 + TypeScript (Turbopack), Prisma 7 +
  PostgreSQL shell, server-only env validation and Prisma client,
  `GET /api/health`, Vitest + Playwright smoke tests, ESLint, CI workflow.
- Prisma database foundation: schema naming conventions (snake_case via
  `@map`/`@@map`, UUID PKs, UTC `created_at`/`updated_at`, Decimal money,
  UPPERCASE enums) per ADRs 002/011/012/013.
- Clerk authentication foundation: official `@clerk/nextjs` integration
  (proxy-based auth context, `ClerkProvider`, minimal `/sign-in` page),
  application `User` model (`users` table: opaque UUID PK, unique
  `clerk_user_id`, `created_at`/`updated_at` timestamptz) with migration
  `20260928204500_add_application_user`, idempotent Clerk→User
  synchronization (`getCurrentUser` / `requireCurrentUser`, server-only),
  and a minimal protected `/app` page enforcing authentication
  server-side. Clerk keys are required env vars
  (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`).

## [0.0.0] - 2026-09-27

### Added
- Repository created.
