import { Prisma } from "@prisma/parceltrack-client";
import type { ShippingType } from "@prisma/parceltrack-client";
import { IdempotencyStatus } from "@prisma/bridge-meta-client";

import { metaDb } from "../db/meta";
import { parceltrackDb } from "../db/parceltrack";
import { TOTAL_TRANSIT_DAYS } from "./constants";
import { isValidTrackingNumberFormat } from "./tracking-number";
import { buildInitialTimeline } from "./timeline";
import {
  acquireReservationLease,
  completeReservationWithFence,
  failReservationWithFence,
  newLeaseOwner,
} from "./reservation";
import type { EligibilityAttestation } from "./eligibility";

export type CreateShipmentInput = {
  storeId: string;
  wooOrderId: string;
  buyerName: string;
  buyerEmail?: string | null;
  originCountry: string;
  destinationCountry: string;
  destinationAddress: string;
  shippingMethod?: string | null;
  shippingType: ShippingType;
  weightKg?: number | null;
  /** Timeline anchor — shipment creation / intended dispatch (NOT Woo order created date). */
  shippingDate: Date;
  estimatedDeliveryDate?: Date | null;
  notes?: string | null;
  mode?: string | null;
  eligibility: EligibilityAttestation;
};

export type CreateShipmentResult = {
  shipmentId: string;
  trackingNumber: string;
  orderId: string;
  alreadyExisted: boolean;
  reconciled: boolean;
};

function fingerprint(input: CreateShipmentInput): string {
  return [
    input.buyerName,
    input.originCountry,
    input.destinationCountry,
    input.destinationAddress,
    input.shippingType,
    input.weightKg ?? "",
  ].join("|");
}

async function logSyncEvent(params: {
  storeId: string;
  wooOrderId: string;
  trackingNumber?: string | null;
  success: boolean;
  message: string;
  mode?: string | null;
}) {
  try {
    await metaDb.syncEvent.create({
      data: {
        storeId: params.storeId,
        wooOrderId: params.wooOrderId,
        trackingNumber: params.trackingNumber ?? null,
        success: params.success,
        message: params.message.slice(0, 500),
        mode: params.mode ?? null,
      },
    });
  } catch {
    // never break creation
  }
}

function assertOwnedShipment(params: {
  shipment: { id: string; trackingNumber: string; orderId: string };
  expectedOrderId: string;
  expectedTrackingNumber: string;
}): void {
  if (params.shipment.trackingNumber !== params.expectedTrackingNumber) {
    throw Object.assign(
      new Error("Tracking number mismatch during reconciliation — refusing to claim shipment"),
      { statusCode: 409 }
    );
  }
  if (String(params.shipment.orderId) !== String(params.expectedOrderId)) {
    throw Object.assign(
      new Error(
        "ParcelTrack orderId does not match WooCommerce order for reserved tracking number"
      ),
      { statusCode: 409 }
    );
  }
}

/**
 * Crash-safe dual-database creation with atomic lease fencing.
 */
export async function createShipmentCrashSafe(
  input: CreateShipmentInput
): Promise<CreateShipmentResult> {
  const wooOrderId = String(input.wooOrderId).trim();
  if (!wooOrderId) {
    throw Object.assign(new Error("wooOrderId is required"), { statusCode: 400 });
  }

  const existing = await metaDb.idempotencyRecord.findUnique({
    where: { storeId_wooOrderId: { storeId: input.storeId, wooOrderId } },
  });

  if (existing?.status === IdempotencyStatus.COMPLETED && existing.parceltrackShipmentId) {
    if (!isValidTrackingNumberFormat(existing.trackingNumber)) {
      throw Object.assign(new Error("Stored tracking number is malformed"), { statusCode: 500 });
    }
    await logSyncEvent({
      storeId: input.storeId,
      wooOrderId,
      trackingNumber: existing.trackingNumber,
      success: true,
      message: "Idempotent hit: completed reservation",
      mode: input.mode,
    });
    return {
      shipmentId: existing.parceltrackShipmentId,
      trackingNumber: existing.trackingNumber,
      orderId: wooOrderId,
      alreadyExisted: true,
      reconciled: false,
    };
  }

  const leaseOwner = newLeaseOwner();
  const acquired = await acquireReservationLease({
    storeId: input.storeId,
    wooOrderId,
    leaseOwner,
    fingerprint: fingerprint(input),
    paymentConfirmedAt: input.eligibility.paymentConfirmedAt,
    paymentEvidence: input.eligibility.paymentEvidence,
    orderStatusAttested: input.eligibility.orderStatus,
  });

  if ("blocked" in acquired) {
    const r = acquired.reservation;
    if (r.status === IdempotencyStatus.COMPLETED && r.parceltrackShipmentId) {
      return {
        shipmentId: r.parceltrackShipmentId,
        trackingNumber: r.trackingNumber,
        orderId: wooOrderId,
        alreadyExisted: true,
        reconciled: false,
      };
    }
    // Another worker holds a valid lease — wait path: if ParcelTrack already has our TRK, reconcile read-only.
    const maybe = await parceltrackDb.shipment.findUnique({
      where: { trackingNumber: r.trackingNumber },
      select: { id: true, trackingNumber: true, orderId: true },
    });
    if (maybe) {
      try {
        assertOwnedShipment({
          shipment: maybe,
          expectedOrderId: wooOrderId,
          expectedTrackingNumber: r.trackingNumber,
        });
        // Best-effort complete without fence if already inserted (crash recovery while lease held by dead worker after expiry is handled on next acquire).
        await metaDb.idempotencyRecord.updateMany({
          where: {
            id: r.id,
            status: { not: IdempotencyStatus.COMPLETED },
            trackingNumber: r.trackingNumber,
          },
          data: {
            status: IdempotencyStatus.COMPLETED,
            parceltrackShipmentId: maybe.id,
            completedAt: new Date(),
            leaseExpiresAt: null,
            lastError: null,
          },
        });
        return {
          shipmentId: maybe.id,
          trackingNumber: maybe.trackingNumber,
          orderId: maybe.orderId,
          alreadyExisted: true,
          reconciled: true,
        };
      } catch {
        // fall through
      }
    }
    throw Object.assign(
      new Error("Synchronization already in progress for this order; retry shortly"),
      { statusCode: 409 }
    );
  }

  const reservation = acquired.reservation;
  const fenceToken = reservation.fenceToken;

  if (!isValidTrackingNumberFormat(reservation.trackingNumber)) {
    await failReservationWithFence({
      reservationId: reservation.id,
      leaseOwner,
      fenceToken,
      error: "Reserved tracking number failed strict validation",
    });
    throw Object.assign(new Error("Reserved tracking number failed strict validation"), {
      statusCode: 500,
    });
  }

  // Crash recovery: ParcelTrack insert succeeded previously under this reservation.
  const alreadyInParceltrack = await parceltrackDb.shipment.findUnique({
    where: { trackingNumber: reservation.trackingNumber },
    select: { id: true, trackingNumber: true, orderId: true },
  });

  if (alreadyInParceltrack) {
    assertOwnedShipment({
      shipment: alreadyInParceltrack,
      expectedOrderId: wooOrderId,
      expectedTrackingNumber: reservation.trackingNumber,
    });
    const ok = await completeReservationWithFence({
      reservationId: reservation.id,
      leaseOwner,
      fenceToken,
      shipmentId: alreadyInParceltrack.id,
      trackingNumber: alreadyInParceltrack.trackingNumber,
    });
    if (!ok) {
      // Lost fence — but shipment exists and matches; treat as success if meta already completed by peer.
      const again = await metaDb.idempotencyRecord.findUnique({ where: { id: reservation.id } });
      if (again?.status === IdempotencyStatus.COMPLETED && again.parceltrackShipmentId) {
        return {
          shipmentId: again.parceltrackShipmentId,
          trackingNumber: again.trackingNumber,
          orderId: wooOrderId,
          alreadyExisted: true,
          reconciled: true,
        };
      }
      throw Object.assign(new Error("Lost lease fence during reconciliation"), { statusCode: 409 });
    }
    await logSyncEvent({
      storeId: input.storeId,
      wooOrderId,
      trackingNumber: alreadyInParceltrack.trackingNumber,
      success: true,
      message: "Reconciled: ParcelTrack shipment existed for reserved tracking number",
      mode: input.mode,
    });
    return {
      shipmentId: alreadyInParceltrack.id,
      trackingNumber: alreadyInParceltrack.trackingNumber,
      orderId: alreadyInParceltrack.orderId,
      alreadyExisted: true,
      reconciled: true,
    };
  }

  const shippingDate = input.shippingDate;
  const estimatedDeliveryDate =
    input.estimatedDeliveryDate ??
    new Date(shippingDate.getTime() + TOTAL_TRANSIT_DAYS * 24 * 60 * 60 * 1000);

  const timeline = buildInitialTimeline(
    shippingDate,
    {
      originCountry: input.originCountry,
      destinationCountry: input.destinationCountry,
      destinationAddress: input.destinationAddress,
    },
    0
  );

  const noteParts = [
    input.notes?.trim() || "",
    input.shippingMethod ? `Shipping method: ${input.shippingMethod}` : "",
    `Payment evidence: ${input.eligibility.paymentEvidence}`,
    `Payment confirmed: ${input.eligibility.paymentConfirmedAt.toISOString()}`,
    `Order status attested: ${input.eligibility.orderStatus}`,
  ].filter(Boolean);

  try {
    const shipment = await parceltrackDb.shipment.create({
      data: {
        trackingNumber: reservation.trackingNumber,
        buyerName: input.buyerName,
        orderId: wooOrderId,
        originCountry: input.originCountry,
        destinationCountry: input.destinationCountry,
        destinationAddress: input.destinationAddress,
        weightKg: input.weightKg ?? null,
        shippingType: input.shippingType,
        notes: noteParts.join(" | ").slice(0, 2000),
        shippingDate,
        estimatedDeliveryDate,
        currentStatus: "ORDER_RECEIVED",
        currentStatusIndex: 0,
        isManualOverride: false,
        timeline: { create: timeline },
      },
      select: { id: true, trackingNumber: true, orderId: true },
    });

    assertOwnedShipment({
      shipment,
      expectedOrderId: wooOrderId,
      expectedTrackingNumber: reservation.trackingNumber,
    });

    const completed = await completeReservationWithFence({
      reservationId: reservation.id,
      leaseOwner,
      fenceToken,
      shipmentId: shipment.id,
      trackingNumber: shipment.trackingNumber,
    });

    if (!completed) {
      // ParcelTrack insert succeeded; metadata complete failed due to fence — next caller reconciles by TRK.
      await logSyncEvent({
        storeId: input.storeId,
        wooOrderId,
        trackingNumber: shipment.trackingNumber,
        success: true,
        message: "ParcelTrack created; metadata fence lost — recoverable via tracking number",
        mode: input.mode,
      });
    } else {
      await logSyncEvent({
        storeId: input.storeId,
        wooOrderId,
        trackingNumber: shipment.trackingNumber,
        success: true,
        message: "Shipment created in ParcelTrack",
        mode: input.mode,
      });
    }

    return {
      shipmentId: shipment.id,
      trackingNumber: shipment.trackingNumber,
      orderId: shipment.orderId,
      alreadyExisted: false,
      reconciled: false,
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const targets = (error.meta?.target as string[] | string | undefined) ?? [];
      const targetStr = Array.isArray(targets) ? targets.join(",") : String(targets);
      const isTrackingCollision =
        targetStr.includes("trackingNumber") || targetStr.includes("tracking_number");

      if (isTrackingCollision) {
        const found = await parceltrackDb.shipment.findUnique({
          where: { trackingNumber: reservation.trackingNumber },
          select: { id: true, trackingNumber: true, orderId: true },
        });
        if (found) {
          try {
            assertOwnedShipment({
              shipment: found,
              expectedOrderId: wooOrderId,
              expectedTrackingNumber: reservation.trackingNumber,
            });
            await completeReservationWithFence({
              reservationId: reservation.id,
              leaseOwner,
              fenceToken,
              shipmentId: found.id,
              trackingNumber: found.trackingNumber,
            });
            await logSyncEvent({
              storeId: input.storeId,
              wooOrderId,
              trackingNumber: found.trackingNumber,
              success: true,
              message: "Reconciled after trackingNumber unique race with ownership verified",
              mode: input.mode,
            });
            return {
              shipmentId: found.id,
              trackingNumber: found.trackingNumber,
              orderId: found.orderId,
              alreadyExisted: true,
              reconciled: true,
            };
          } catch (ownershipError) {
            await failReservationWithFence({
              reservationId: reservation.id,
              leaseOwner,
              fenceToken,
              error:
                ownershipError instanceof Error
                  ? ownershipError.message
                  : "Tracking collision ownership failure",
            });
            throw ownershipError;
          }
        }
      }

      await failReservationWithFence({
        reservationId: reservation.id,
        leaseOwner,
        fenceToken,
        error: `Unique constraint: ${targetStr || "unknown"}`,
      });
      throw Object.assign(new Error("Database unique constraint conflict"), { statusCode: 409 });
    }

    const message = error instanceof Error ? error.message : "Unknown create error";
    await failReservationWithFence({
      reservationId: reservation.id,
      leaseOwner,
      fenceToken,
      error: message,
    });
    await logSyncEvent({
      storeId: input.storeId,
      wooOrderId,
      trackingNumber: reservation.trackingNumber,
      success: false,
      message,
      mode: input.mode,
    });
    throw error;
  }
}

/** Public fields only — no buyer PII for cross-store leakage. */
export type PublicShipmentView = {
  id: string;
  trackingNumber: string;
  orderId: string;
  currentStatus: string;
  originCountry: string;
  destinationCountry: string;
  shippingType: string;
  shippingDate: Date;
  estimatedDeliveryDate: Date;
  createdAt: Date;
};

export async function getShipmentForStore(
  storeId: string,
  trackingNumberRaw: string
): Promise<PublicShipmentView | null> {
  const trackingNumber = trackingNumberRaw.trim().toUpperCase();
  if (!isValidTrackingNumberFormat(trackingNumber)) {
    throw Object.assign(new Error("Invalid tracking number format"), { statusCode: 400 });
  }

  const owned = await metaDb.idempotencyRecord.findFirst({
    where: { storeId, trackingNumber },
    select: { id: true, status: true },
  });
  if (!owned) {
    return null;
  }

  const shipment = await parceltrackDb.shipment.findUnique({
    where: { trackingNumber },
    select: {
      id: true,
      trackingNumber: true,
      orderId: true,
      currentStatus: true,
      originCountry: true,
      destinationCountry: true,
      shippingType: true,
      shippingDate: true,
      estimatedDeliveryDate: true,
      createdAt: true,
    },
  });
  return shipment;
}

export async function getOrderMapping(storeId: string, orderId: string) {
  const record = await metaDb.idempotencyRecord.findUnique({
    where: {
      storeId_wooOrderId: {
        storeId,
        wooOrderId: String(orderId).trim(),
      },
    },
  });
  if (!record) return null;

  let shipment = null;
  if (record.parceltrackShipmentId) {
    shipment = await parceltrackDb.shipment.findUnique({
      where: { id: record.parceltrackShipmentId },
      select: {
        id: true,
        trackingNumber: true,
        orderId: true,
        currentStatus: true,
        createdAt: true,
      },
    });
  } else if (record.trackingNumber) {
    shipment = await parceltrackDb.shipment.findUnique({
      where: { trackingNumber: record.trackingNumber },
      select: {
        id: true,
        trackingNumber: true,
        orderId: true,
        currentStatus: true,
        createdAt: true,
      },
    });
  }

  return { record, shipment };
}
