import { Router } from "express";
import { requireStoreAuth, type AuthedRequest } from "../middleware/auth";
import { createShipmentBodySchema } from "../validation/shipment";
import { createShipmentCrashSafe, getShipmentForStore } from "../lib/shipment-service";
import { TOTAL_TRANSIT_DAYS } from "../lib/constants";
import { isValidTrackingNumberFormat } from "../lib/tracking-number";
import { validateEligibilityAttestation } from "../lib/eligibility";

export const shipmentsRouter = Router();

shipmentsRouter.post("/api/shipments", requireStoreAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = createShipmentBodySchema.parse(req.body);
    const store = req.store!;

    const eligibility = validateEligibilityAttestation({
      orderStatus: body.eligibility.orderStatus,
      paymentConfirmedAt: body.eligibility.paymentConfirmedAt,
      paymentEvidence: body.eligibility.paymentEvidence,
      attestedEligible: body.eligibility.attestedEligible,
      allowedCustomPaidStatus: body.eligibility.customPaidStatus,
    });

    // Timeline starts at intended dispatch / Bridge creation time — NOT Woo order createdAt.
    const shippingDate = body.shippingDate ? new Date(body.shippingDate) : new Date();
    let estimatedDeliveryDate: Date | null = body.estimatedDeliveryDate
      ? new Date(body.estimatedDeliveryDate)
      : null;
    if (!estimatedDeliveryDate) {
      const days = body.estimatedDeliveryDays ?? TOTAL_TRANSIT_DAYS;
      estimatedDeliveryDate = new Date(shippingDate.getTime() + days * 24 * 60 * 60 * 1000);
    }

    const result = await createShipmentCrashSafe({
      storeId: store.id,
      wooOrderId: body.orderId,
      buyerName: body.buyerName,
      buyerEmail: body.buyerEmail,
      originCountry: body.originCountry,
      destinationCountry: body.destinationCountry,
      destinationAddress: body.destinationAddress,
      shippingMethod: body.shippingMethod,
      shippingType: body.shippingType,
      weightKg: body.weightKg,
      shippingDate,
      estimatedDeliveryDate,
      notes: body.notes,
      mode: body.mode,
      eligibility,
    });

    if (!isValidTrackingNumberFormat(result.trackingNumber) || !result.shipmentId) {
      return res.status(500).json({ error: "Bridge produced an invalid shipment response" });
    }

    res.status(result.alreadyExisted ? 200 : 201).json({
      ok: true,
      shipmentId: result.shipmentId,
      trackingNumber: result.trackingNumber,
      orderId: result.orderId,
      alreadyExisted: result.alreadyExisted,
      reconciled: result.reconciled,
      storeId: store.id,
    });
  } catch (error) {
    next(error);
  }
});

shipmentsRouter.get(
  "/api/shipments/:trackingNumber",
  requireStoreAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      const trackingNumber = String(req.params.trackingNumber || "");
      if (!isValidTrackingNumberFormat(trackingNumber)) {
        return res.status(400).json({ error: "Invalid tracking number format" });
      }

      const shipment = await getShipmentForStore(req.store!.id, trackingNumber);
      if (!shipment) {
        // Do not reveal whether the tracking exists for another store.
        return res.status(404).json({ error: "Shipment not found" });
      }

      return res.json({
        ok: true,
        shipment: {
          id: shipment.id,
          trackingNumber: shipment.trackingNumber,
          orderId: shipment.orderId,
          currentStatus: shipment.currentStatus,
          originCountry: shipment.originCountry,
          destinationCountry: shipment.destinationCountry,
          shippingType: shipment.shippingType,
          shippingDate: shipment.shippingDate,
          estimatedDeliveryDate: shipment.estimatedDeliveryDate,
          createdAt: shipment.createdAt,
        },
      });
    } catch (error) {
      return next(error);
    }
  }
);
