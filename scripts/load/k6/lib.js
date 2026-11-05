/* eslint-disable */
// Executed by the k6 runtime, not Node.js/Next.js — see smoke.js for
// why this file opts out of the repository ESLint run.
//
// Shared building blocks for the load scenarios in this directory.
//
// Safety, enforced here as well as in the Node wrappers (defense in
// depth, so a scenario invoked directly with `k6 run` is still
// constrained):
//   - BASE_URL must be an http URL on a loopback host. These scripts
//     are local-only and refuse any other target at init time.
//   - ACTORS_FILE must point at a seed-generated actors file; actor
//     sessions exist only in the seeded disposable database, so a
//     scenario pointed at an unseeded application fails its checks
//     instead of generating meaningful load against real data.
//
// Authentication: seeded member sessions only (gym_member_session
// cookie). No Clerk, no OTP, no APITxT — see README.md.
import http from "k6/http";
import { check } from "k6";
import { SharedArray } from "k6/data";

export const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

(function assertLocalTarget() {
  // NOTE: the k6 runtime has no URL constructor — parse manually.
  // The pattern anchors the scheme to exactly "http://" and captures
  // the authority's host part; anything else (userinfo tricks such as
  // http://localhost@evil.com, look-alike hosts, trailing dots) fails
  // the allowlist comparison below and is refused, fail-closed.
  const match = /^http:\/\/(\[[0-9a-fA-F:]+\]|[^/:?#]+)(?::\d+)?(?:[/?#]|$)/.exec(BASE_URL);
  const host = match ? match[1].replace(/^\[|\]$/g, "").toLowerCase() : null;
  if (!host || !["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(
      `BASE_URL "${BASE_URL}" is not an http loopback URL — these load scripts are local-only.`,
    );
  }
})();

if (!__ENV.ACTORS_FILE) {
  throw new Error("ACTORS_FILE is not set — run via the guarded wrappers (see README.md).");
}

export const actors = new SharedArray("actors", function () {
  const parsed = JSON.parse(open(__ENV.ACTORS_FILE));
  if (!parsed.actors || parsed.actors.length === 0) {
    throw new Error(`No actors found in ${__ENV.ACTORS_FILE} — run the seed first.`);
  }
  return parsed.actors;
});

export function actorForVu(vu) {
  return actors[(vu - 1) % actors.length];
}

function sessionHeaders(actor) {
  return {
    Cookie: `gym_member_session=${actor.token}`,
    "Content-Type": "application/json",
  };
}

// One standard member iteration: liveness, the three member pages,
// and a self check-in for the actor's own gym. Requests carry `name`
// tags so thresholds can be set per surface. "checked_in" and
// "already_checked_in" are both successes (together they exercise the
// one-open-session rule).
export function memberIteration(actor) {
  const headers = sessionHeaders(actor);

  const health = http.get(`${BASE_URL}/api/health`, { tags: { name: "GET /api/health" } });
  check(health, {
    "health is 200": (r) => r.status === 200,
    "health reports ok": (r) => r.json("status") === "ok",
  });

  const home = http.get(`${BASE_URL}/member`, { headers, tags: { name: "GET /member" } });
  check(home, { "member home is 200": (r) => r.status === 200 });

  const payments = http.get(`${BASE_URL}/member/payments`, {
    headers,
    tags: { name: "GET /member/payments" },
  });
  check(payments, { "member payments is 200": (r) => r.status === 200 });

  const attendance = http.get(`${BASE_URL}/member/attendance`, {
    headers,
    tags: { name: "GET /member/attendance" },
  });
  check(attendance, { "member attendance is 200": (r) => r.status === 200 });

  checkIn(actor);
}

// A single self check-in attempt for the actor's own gym.
export function checkIn(actor) {
  const res = http.post(
    `${BASE_URL}/api/member-attendance/check-in`,
    JSON.stringify({ gym: actor.gymId }),
    { headers: sessionHeaders(actor), tags: { name: "POST /api/member-attendance/check-in" } },
  );
  check(res, {
    "check-in is 200": (r) => r.status === 200,
    "check-in result is checked_in or already_checked_in": (r) =>
      r.json("result") === "checked_in" || r.json("result") === "already_checked_in",
  });
  return res;
}
