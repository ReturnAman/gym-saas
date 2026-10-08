import "server-only";

import type { Prisma } from "@prisma/client";

/**
 * Minimal audit logging (ADR 017).
 *
 * Deliberately small: one append-only AuditLog table and this single write
 * helper. Events are stable string codes; only the events a slice actually
 * emits are written — Payments V1 writes PAYMENT_CONFIRMED. The helper
 * takes the caller's transaction client so a financial mutation and its
 * audit event commit atomically: either both exist or neither does.
 */

/** Audit event codes written by the application. */
export const AUDIT_EVENT_PAYMENT_CONFIRMED = "PAYMENT_CONFIRMED";
export const AUDIT_EVENT_MEMBER_LINKED = "MEMBER_LINKED";

export interface AuditEventInput {
  organizationId: string;
  actorUserId: string;
  event: string;
  targetType: string;
  targetId: string;
  metadata?: Prisma.InputJsonValue;
}

/** Append one audit event inside the caller's transaction. */
export async function writeAuditEvent(
  tx: Prisma.TransactionClient,
  input: AuditEventInput,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      event: input.event,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata,
    },
  });
}
