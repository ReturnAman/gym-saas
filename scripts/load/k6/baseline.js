/* eslint-disable */
// Executed by the k6 runtime — see lib.js.
//
// BASELINE SCENARIO — PREPARED, NOT YET RUN.
// scripts/load/k6/baseline.js — 50 virtual users for 15 minutes.
//
// This is the audit's "baseline" stage, restricted to the surfaces
// the harness can authenticate today: member-session paths plus
// liveness. The audit's full mix also includes staff surfaces
// (member list, member detail, staff-recorded payments), which are
// NOT in this script — Clerk sessions cannot be seeded, and the
// staff-auth strategy for load testing is an open decision (see
// README.md). Until that is resolved, VU-for-VU this script
// over-weights member traffic relative to the audit mix; treat its
// results as member-path evidence, not whole-system evidence.
//
// Thresholds are the audit's targets for the covered surfaces:
// reads p95 < 500 ms, writes p95 < 800 ms, errors < 0.5%.
//
// Actor mapping: the seed produces 28 actors and actorForVu maps
// VU n to actors[(n - 1) % 28], so at 50 VUs actors 1–22 are each
// driven by TWO virtual users concurrently and actors 23–28 by
// one. That reuse is intentional: the paired VUs issue simultaneous
// duplicate check-ins for the same member, exercising the
// one-open-session rule under genuine concurrency — the first
// writer creates the session and concurrent repeats must return
// already_checked_in, never a second open session. Expected
// post-run state: exactly 28 new attendance rows, one open session
// per actor member.
//
// Prerequisite: the smoke test passes (it did, 2026-10-19). Run
// ONLY via the guarded wrapper (same safety model as the smoke
// wrapper: disposable-database guard + explicit confirmation,
// actors/database match, and a seeded-session binding probe before
// k6 is invoked):
//   DATABASE_URL=… LOAD_TEST_CONFIRM_DATABASE=… \
//     node scripts/load/run-baseline.mjs
// The baseline runs against the application's DEFAULT pool
// configuration (max 8). The DB_POOL_MAX sweep is a peak-stage
// question and is not part of this stage.
import { sleep } from "k6";
import { actorForVu, memberIteration } from "./lib.js";

export const options = {
  scenarios: {
    baseline: {
      executor: "constant-vus",
      vus: 50,
      duration: "15m",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.005"],
    checks: ["rate>0.99"],
    "http_req_duration{name:GET /member}": ["p(95)<500"],
    "http_req_duration{name:GET /member/payments}": ["p(95)<500"],
    "http_req_duration{name:GET /member/attendance}": ["p(95)<500"],
    "http_req_duration{name:POST /api/member-attendance/check-in}": ["p(95)<800"],
  },
};

export default function () {
  memberIteration(actorForVu(__VU));
  sleep(1 + Math.random() * 2);
}
