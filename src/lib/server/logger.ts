import "server-only";

import { classifyDatabaseError } from "./db-errors";

/**
 * Structured diagnostic logging (H3).
 *
 * LOGGING BOUNDARY — read before adding a log call. An exception is
 * logged exactly once, at the boundary that converts it into a
 * response, and nowhere else:
 *
 * - API route handlers log in their final catch, on the branches that
 *   produce a 503 (classified database failure) or a 500 (unexpected
 *   error). Typed business failures (validation, authorization,
 *   not-found, conflicts, idempotent replays) are expected outcomes
 *   and are never logged.
 * - Server actions have no single wrapper, so only the existing
 *   central error translators log: the payment action
 *   (recordPaymentAction), the claim-decision mapper
 *   (mapDecisionError), the staff message mapper (toSafeMessage),
 *   and the platform-admin notice mapper (failureNotice).
 * - Services NEVER log: they throw typed errors and let the boundary
 *   decide. If you add a call anywhere else, the same exception will
 *   be logged twice.
 *
 * REDACTION BY CONSTRUCTION. A log record is assembled only from the
 * whitelisted scalar fields below — there is no parameter that accepts
 * a message, a body, or an arbitrary object. Error objects are never
 * serialized: only their class name, an allowlisted error code (see
 * safeErrorCode), and the H2 database classification are emitted.
 * Error messages are deliberately NOT logged — they can contain SQL,
 * hostnames, connection details, or member data. OTPs, tokens,
 * cookies, authorization headers, payment references, and member
 * personal data therefore cannot reach a log line through this module.
 *
 * Audit events (src/lib/server/audit.ts) are a separate, durable,
 * tenant-scoped record of business facts. These logs are operational
 * diagnostics only and never replace or duplicate audit events.
 *
 * The logger itself must never break a request: every public helper
 * is non-throwing end to end. Inspecting an error (classification,
 * name/code extraction) can throw on hostile objects with throwing
 * getters, so all inspection sits behind safeExtract / a guarded
 * classification, degrading to a minimal record; emission is
 * additionally wrapped so a failing console or serialization can
 * never mask the original error or turn a handled failure into a
 * thrown one.
 */

export type LogLevel = "info" | "warn" | "error";

export interface ServerLogEvent {
  level: LogLevel;
  /** Stable event name, e.g. "database_unavailable". */
  event: string;
  /** Where the failure was converted into a response, e.g. "POST /api/member-payments/claims" or "action:recordPayment". */
  boundary: string;
  requestId?: string;
  errorKind?: string;
  errorName?: string;
  errorCode?: string;
}

export function logServerEvent(entry: ServerLogEvent): void {
  try {
    const record: Record<string, string> = {
      ts: new Date().toISOString(),
      level: entry.level,
      event: entry.event,
      boundary: entry.boundary,
    };
    if (entry.requestId) record.requestId = entry.requestId;
    if (entry.errorKind) record.errorKind = entry.errorKind;
    if (entry.errorName) record.errorName = entry.errorName;
    if (entry.errorCode) record.errorCode = entry.errorCode;
    const line = JSON.stringify(record);
    if (entry.level === "error") console.error(line);
    else if (entry.level === "warn") console.warn(line);
    else console.info(line);
  } catch {
    // Logging must never throw into the request path.
  }
}

/** Error class name only — never the message. */
function safeErrorName(error: unknown): string {
  if (error instanceof Error) {
    const name = error.name;
    // A hostile or careless error object can carry a non-string name;
    // only a bounded string is loggable.
    return typeof name === "string" && name.length > 0
      ? name.slice(0, 100)
      : "Error";
  }
  return "UnknownError";
}

/**
 * An error code is loggable only when its SHAPE proves it is a code:
 * a Prisma P-code (P1001), a five-digit SQLSTATE (57014), or a short
 * uppercase errno-style token (ECONNREFUSED). Anything else — which
 * could be user data in disguise — is dropped.
 */
function safeErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as Record<string, unknown>).code;
  if (typeof code !== "string") return undefined;
  if (/^P\d{4}$/.test(code)) return code;
  if (/^\d{5}$/.test(code)) return code;
  if (/^[A-Z][A-Z0-9_]{2,11}$/.test(code)) return code;
  return undefined;
}

/**
 * Extract the loggable fields from an error WITHOUT ever throwing.
 * Inspecting an error object can itself throw — a hostile or exotic
 * object may define throwing getters for `name`, `code`, `cause`, or
 * `meta` (the H3 review proved all four against the previous
 * implementation). Any inspection failure degrades to no fields: the
 * caller still emits its minimal record (event + boundary), and the
 * logging path can never mask the original application error.
 */
function safeExtract(error: unknown): {
  errorName?: string;
  errorCode?: string;
} {
  try {
    const fields: { errorName?: string; errorCode?: string } = {};
    fields.errorName = safeErrorName(error);
    const code = safeErrorCode(error);
    if (code) fields.errorCode = code;
    return fields;
  } catch {
    return {};
  }
}

/**
 * Log a classified database failure at a response boundary. A no-op
 * for anything the H2 classifier does not recognize — unexpected
 * errors belong to logUnexpectedError, and the two never both fire
 * for one exception. Non-throwing: if classification itself fails on
 * a hostile error object, a minimal record is emitted instead (the
 * caller invoked this helper because it already determined the
 * failure is database-classified).
 */
export function logDatabaseFailure(args: {
  boundary: string;
  requestId?: string;
  error: unknown;
}): void {
  let kind: ReturnType<typeof classifyDatabaseError> = null;
  let classificationFailed = false;
  try {
    kind = classifyDatabaseError(args.error);
  } catch {
    classificationFailed = true;
  }
  if (!kind && !classificationFailed) return;
  logServerEvent({
    level: "error",
    event: "database_unavailable",
    boundary: args.boundary,
    requestId: args.requestId,
    ...(kind ? { errorKind: kind } : {}),
    ...safeExtract(args.error),
  });
}

/** Log an unexpected (unclassified) server error at a boundary. */
export function logUnexpectedError(args: {
  boundary: string;
  requestId?: string;
  error: unknown;
}): void {
  logServerEvent({
    level: "error",
    event: "unexpected_error",
    boundary: args.boundary,
    requestId: args.requestId,
    ...safeExtract(args.error),
  });
}

/** Log an SMS provider outage at the member-auth route boundary. */
export function logProviderUnavailable(args: {
  boundary: string;
  requestId?: string;
}): void {
  logServerEvent({
    level: "warn",
    event: "sms_provider_unavailable",
    boundary: args.boundary,
    requestId: args.requestId,
  });
}
