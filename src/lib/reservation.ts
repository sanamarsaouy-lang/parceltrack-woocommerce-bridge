import { randomBytes } from "crypto";
import { IdempotencyStatus, Prisma } from "@prisma/bridge-meta-client";
import { metaDb } from "../db/meta";
import { config } from "../config";
import { generateUniqueTrackingNumber } from "./tracking-number";

export type ReservationRow = {
  id: string;
  storeId: string;
  wooOrderId: string;
  trackingNumber: string;
  parceltrackShipmentId: string | null;
  status: IdempotencyStatus;
  leaseOwner: string | null;
  fenceToken: number;
  leaseExpiresAt: Date | null;
  attemptCount: number;
};

export function newLeaseOwner(): string {
  return `lease_${randomBytes(16).toString("hex")}`;
}

/**
 * Pure decision helper used by tests and documentation of lease rules.
 * A worker may acquire/refresh a lease when the row is not COMPLETED and either:
 * - lease is expired / missing, or
 * - the same owner already holds it, or
 * - status is FAILED
 */
export function canAcquireLease(params: {
  status: IdempotencyStatus | string;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  now: Date;
  requesterOwner: string;
}): boolean {
  if (params.status === IdempotencyStatus.COMPLETED || params.status === "COMPLETED") {
    return false;
  }
  if (params.leaseOwner === params.requesterOwner) return true;
  if (params.status === IdempotencyStatus.FAILED || params.status === "FAILED") return true;
  if (!params.leaseExpiresAt) return true;
  return params.leaseExpiresAt.getTime() <= params.now.getTime();
}

/**
 * Atomically create-or-acquire a reservation lease using PostgreSQL UPDATE fencing.
 * Returns null if another worker currently holds a valid lease.
 */
export async function acquireReservationLease(params: {
  storeId: string;
  wooOrderId: string;
  leaseOwner: string;
  fingerprint: string;
  paymentConfirmedAt: Date;
  paymentEvidence: string;
  orderStatusAttested: string;
}): Promise<{ reservation: ReservationRow; created: boolean } | { blocked: true; reservation: ReservationRow }> {
  const existing = await metaDb.idempotencyRecord.findUnique({
    where: {
      storeId_wooOrderId: {
        storeId: params.storeId,
        wooOrderId: params.wooOrderId,
      },
    },
  });

  if (existing?.status === IdempotencyStatus.COMPLETED) {
    return { blocked: true, reservation: existing as ReservationRow };
  }

  if (!existing) {
    const trackingNumber = await generateUniqueTrackingNumber();
    try {
      const created = await metaDb.idempotencyRecord.create({
        data: {
          storeId: params.storeId,
          wooOrderId: params.wooOrderId,
          trackingNumber,
          status: IdempotencyStatus.RESERVED,
          requestFingerprint: params.fingerprint,
          attemptCount: 1,
          leaseOwner: params.leaseOwner,
          fenceToken: 1,
          leaseExpiresAt: new Date(Date.now() + config.leaseMs),
          paymentConfirmedAt: params.paymentConfirmedAt,
          paymentEvidence: params.paymentEvidence,
          orderStatusAttested: params.orderStatusAttested,
        },
      });
      return { reservation: created as ReservationRow, created: true };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }
      // Concurrent create — fall through to atomic acquire on the winner row.
    }
  }

  const leaseExpiresAt = new Date(Date.now() + config.leaseMs);

  // Atomic fencing: only one requester can take ownership when lease is free/expired/failed/same-owner.
  const acquired = await metaDb.$queryRaw<ReservationRow[]>`
    UPDATE idempotency_records
    SET
      status = 'RESERVED',
      "leaseOwner" = ${params.leaseOwner},
      "fenceToken" = "fenceToken" + 1,
      "leaseExpiresAt" = ${leaseExpiresAt},
      "attemptCount" = "attemptCount" + 1,
      "requestFingerprint" = ${params.fingerprint},
      "paymentConfirmedAt" = ${params.paymentConfirmedAt},
      "paymentEvidence" = ${params.paymentEvidence},
      "orderStatusAttested" = ${params.orderStatusAttested},
      "lastError" = NULL,
      "updatedAt" = NOW()
    WHERE "storeId" = ${params.storeId}
      AND "wooOrderId" = ${params.wooOrderId}
      AND status <> 'COMPLETED'
      AND (
        "leaseOwner" IS NULL
        OR "leaseOwner" = ${params.leaseOwner}
        OR "leaseExpiresAt" IS NULL
        OR "leaseExpiresAt" < NOW()
        OR status = 'FAILED'
      )
    RETURNING
      id, "storeId", "wooOrderId", "trackingNumber", "parceltrackShipmentId",
      status, "leaseOwner", "fenceToken", "leaseExpiresAt", "attemptCount"
  `;

  if (acquired.length === 1) {
    return { reservation: acquired[0], created: false };
  }

  const current = await metaDb.idempotencyRecord.findUniqueOrThrow({
    where: {
      storeId_wooOrderId: {
        storeId: params.storeId,
        wooOrderId: params.wooOrderId,
      },
    },
  });

  return { blocked: true, reservation: current as ReservationRow };
}

/**
 * Complete only if this worker still owns the lease fence token.
 */
export async function completeReservationWithFence(params: {
  reservationId: string;
  leaseOwner: string;
  fenceToken: number;
  shipmentId: string;
  trackingNumber: string;
}): Promise<boolean> {
  const updated = await metaDb.$queryRaw<{ id: string }[]>`
    UPDATE idempotency_records
    SET
      status = 'COMPLETED',
      "parceltrackShipmentId" = ${params.shipmentId},
      "trackingNumber" = ${params.trackingNumber},
      "completedAt" = NOW(),
      "leaseExpiresAt" = NULL,
      "lastError" = NULL,
      "updatedAt" = NOW()
    WHERE id = ${params.reservationId}
      AND "leaseOwner" = ${params.leaseOwner}
      AND "fenceToken" = ${params.fenceToken}
      AND status <> 'COMPLETED'
    RETURNING id
  `;
  return updated.length === 1;
}

export async function failReservationWithFence(params: {
  reservationId: string;
  leaseOwner: string;
  fenceToken: number;
  error: string;
}): Promise<void> {
  await metaDb.$executeRaw`
    UPDATE idempotency_records
    SET
      status = 'FAILED',
      "lastError" = ${params.error.slice(0, 500)},
      "leaseExpiresAt" = NULL,
      "updatedAt" = NOW()
    WHERE id = ${params.reservationId}
      AND "leaseOwner" = ${params.leaseOwner}
      AND "fenceToken" = ${params.fenceToken}
      AND status <> 'COMPLETED'
  `;
}

/**
 * In-memory lease simulator for concurrency unit tests (no Postgres required).
 */
export class InMemoryLeaseStore {
  private rows = new Map<string, ReservationRow & { key: string }>();

  tryAcquire(key: string, owner: string, trackingNumber: string, now = new Date()): ReservationRow | null {
    const existing = this.rows.get(key);
    if (!existing) {
      const row: ReservationRow & { key: string } = {
        key,
        id: key,
        storeId: "s",
        wooOrderId: key,
        trackingNumber,
        parceltrackShipmentId: null,
        status: IdempotencyStatus.RESERVED,
        leaseOwner: owner,
        fenceToken: 1,
        leaseExpiresAt: new Date(now.getTime() + 60_000),
        attemptCount: 1,
      };
      this.rows.set(key, row);
      return { ...row };
    }
    if (
      !canAcquireLease({
        status: existing.status,
        leaseOwner: existing.leaseOwner,
        leaseExpiresAt: existing.leaseExpiresAt,
        now,
        requesterOwner: owner,
      })
    ) {
      return null;
    }
    existing.leaseOwner = owner;
    existing.fenceToken += 1;
    existing.leaseExpiresAt = new Date(now.getTime() + 60_000);
    existing.status = IdempotencyStatus.RESERVED;
    existing.attemptCount += 1;
    return { ...existing };
  }

  complete(id: string, owner: string, fenceToken: number, shipmentId: string): boolean {
    const row = this.rows.get(id);
    if (!row) return false;
    if (row.leaseOwner !== owner || row.fenceToken !== fenceToken) return false;
    if (row.status === IdempotencyStatus.COMPLETED) return false;
    row.status = IdempotencyStatus.COMPLETED;
    row.parceltrackShipmentId = shipmentId;
    row.leaseExpiresAt = null;
    return true;
  }

  get(key: string) {
    return this.rows.get(key);
  }
}
