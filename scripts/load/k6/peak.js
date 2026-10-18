/* eslint-disable */
// Executed by the k6 runtime — see lib.js.
//
// PEAK SCENARIO — PREPARED, NOT YET RUN.
// scripts/load/k6/peak.js — 150 virtual users for 15 minutes, plus a
// check-in burst scenario modelling a class start: 30 check-ins
// inside 60 seconds, sustained for 5 minutes, spread across actors
// from different gyms.
//
// Same coverage restriction as baseline.js: member-session surfaces
// only. Staff surfaces from the audit mix (including the month-start
// payment-recording burst) are NOT included — the staff-auth
// strategy for load testing is an open decision. Do not read results
// from this script as whole-system peak evidence.
//
// Thresholds are the audit's targets for the covered surfaces:
// reads p95 < 500 ms, writes p95 < 800 ms, errors < 0.5%. A rising
// share of 503 DATABASE_UNAVAILABLE responses or pool-timeout log
// lines during this stage is the pool-saturation signal — see the
// instrumentation section of README.md.
//
// Do not run until the baseline stage passes and this file has been
// reviewed. A guarded wrapper for this scenario does not exist yet.
import { sleep } from "k6";
import { actorForVu, actors, checkIn, memberIteration } from "./lib.js";

export const options = {
  scenarios: {
    peak: {
      executor: "constant-vus",
      vus: 150,
      duration: "15m",
    },
    checkin_burst: {
      executor: "constant-arrival-rate",
      rate: 30,
      timeUnit: "1m",
      duration: "5m",
      startTime: "5m",
      preAllocatedVUs: 40,
      maxVUs: 60,
      exec: "burst",
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

// Burst iterations rotate through ALL actors (not per-VU), so the 30
// arrivals per minute land on distinct members across gyms — the
// duplicate-attempt behaviour is covered separately by the main
// scenario's repeat check-ins returning already_checked_in.
export function burst() {
  const actor = actors[Math.floor(Math.random() * actors.length)];
  checkIn(actor);
}
