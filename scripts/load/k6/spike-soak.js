/* eslint-disable */
// Executed by the k6 runtime — see lib.js.
//
// SPIKE + SOAK SCENARIO — PREPARED, NOT YET RUN.
// scripts/load/k6/spike-soak.js — ramp to 300 virtual users, hold a
// 5-minute spike, then settle to 150 users for a 30-minute soak.
//
// Same coverage restriction as baseline.js and peak.js:
// member-session surfaces only; staff surfaces await the open
// staff-auth decision. Thresholds are the audit's spike targets for
// the covered surfaces (errors < 2% at 300 VU) with the soak held to
// the peak targets (errors < 0.5%).
//
// The soak half exists to surface slow leaks the short stages hide:
// growth in the unbounded list reads, session-touch write load, and
// pool behaviour over time. Pair this stage with before/during/after
// snapshots from scripts/load/collect-stats.mjs.
//
// Do not run until the peak stage passes and this file has been
// reviewed. A guarded wrapper for this scenario does not exist yet.
import { sleep } from "k6";
import { actorForVu, memberIteration } from "./lib.js";

export const options = {
  scenarios: {
    spike_soak: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 300 },
        { duration: "3m", target: 300 },
        { duration: "2m", target: 150 },
        { duration: "30m", target: 150 },
        { duration: "1m", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.02"],
    checks: ["rate>0.98"],
    "http_req_duration{name:POST /api/member-attendance/check-in}": ["p(95)<800"],
  },
};

export default function () {
  memberIteration(actorForVu(__VU));
  sleep(1 + Math.random() * 2);
}
