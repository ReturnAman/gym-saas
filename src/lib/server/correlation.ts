import "server-only";

/**
 * Request correlation IDs (H3).
 *
 * An API request may arrive with an `x-request-id` header (from a
 * proxy, a client, or a support report). It is propagated into log
 * records and echoed on failure responses ONLY when it passes strict
 * validation — an unvalidated header is attacker-controlled text and
 * must never reach a log line or a response unchecked. Anything else
 * gets a freshly generated UUID.
 */

export const REQUEST_ID_HEADER = "x-request-id";

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;

/** A correlation ID is 8–64 chars: alphanumerics, "-" or "_". */
export function isValidCorrelationId(value: unknown): value is string {
  return typeof value === "string" && CORRELATION_ID_PATTERN.test(value);
}

export function resolveCorrelationId(request: Request): string {
  const incoming = request.headers.get(REQUEST_ID_HEADER);
  if (isValidCorrelationId(incoming)) return incoming;
  return crypto.randomUUID();
}

/** Echo the correlation ID on a response so a reporter can quote it. */
export function withCorrelationId<T extends Response>(
  response: T,
  requestId: string,
): T {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}
