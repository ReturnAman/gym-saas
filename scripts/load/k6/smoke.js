/* eslint-disable */
// The line above opts this file out of the repository's ESLint run on
// purpose: it is executed by the k6 runtime (https://k6.io), not by
// Node.js or Next.js — see lib.js for the shared setup it uses.
//
// SMOKE TEST — scripts/load/k6/smoke.js
//
// 5 virtual users for 5 minutes, each VU acting as one seeded member:
// liveness, member home, member payments, member attendance, and a
// self check-in for the actor's own gym ("checked_in" first pass,
// "already_checked_in" afterwards — both pass).
//
// Thresholds below are SMOKE gates (the run is healthy and the paths
// behave), not the capacity targets from the load-test audit — a
// 5-user local smoke passing says nothing about 150-user capacity.
//
// Run via the guarded wrapper, not directly:
//   node scripts/load/run-smoke.mjs
import { sleep } from "k6";
import { actorForVu, memberIteration } from "./lib.js";

export const options = {
  scenarios: {
    smoke: {
      executor: "constant-vus",
      vus: 5,
      duration: "5m",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1500"],
    checks: ["rate>0.99"],
  },
};

export default function () {
  memberIteration(actorForVu(__VU));
  sleep(1 + Math.random() * 2);
}
