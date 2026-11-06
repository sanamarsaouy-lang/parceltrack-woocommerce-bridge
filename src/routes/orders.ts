import { Router } from "express";
import { requireStoreAuth, type AuthedRequest } from "../middleware/auth";
import { getOrderMapping } from "../lib/shipment-service";

export const ordersRouter = Router();

ordersRouter.get(
  "/api/orders/:storeId/:orderId",
  requireStoreAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      const store = req.store!;
      const storeId = String(req.params.storeId);
      const orderId = String(req.params.orderId);

      // Stores may only query their own mappings.
      if (storeId !== store.id) {
        return res.status(403).json({ error: "storeId does not match authenticated store" });
      }

      const mapping = await getOrderMapping(storeId, orderId);
      if (!mapping) {
        return res.status(404).json({ error: "No synchronization record for this order" });
      }

      return res.json({
        ok: true,
        storeId,
        orderId,
        status: mapping.record.status,
        trackingNumber: mapping.record.trackingNumber,
        shipmentId: mapping.record.parceltrackShipmentId ?? mapping.shipment?.id ?? null,
        shipment: mapping.shipment,
        attemptCount: mapping.record.attemptCount,
        completedAt: mapping.record.completedAt,
        lastError: mapping.record.lastError,
      });
    } catch (error) {
      return next(error);
    }
  }
);
