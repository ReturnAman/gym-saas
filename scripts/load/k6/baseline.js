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
// Do not run until: the smoke test passes, this file has been
// reviewed, and the pool-sweep plan (DB_POOL_MAX 8 → 12 → 16) is
// agreed. A guarded wrapper for this scenario does not exist yet —
// run directly only under the conditions in README.md:
//   BASE_URL=http://localhost:3000 ACTORS_FILE=scripts/load/actors.local.json \
//     k6 run scripts/load/k6/baseline.js
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
