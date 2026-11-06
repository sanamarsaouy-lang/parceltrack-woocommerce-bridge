import { Router } from "express";
import { z } from "zod";
import { requireAdminAuth, requireStoreAuth, type AuthedRequest } from "../middleware/auth";
import {
  createStore,
  getRecentSyncDiagnostics,
  listStores,
} from "../lib/store-service";

export const adminRouter = Router();

adminRouter.post("/api/admin/stores", requireAdminAuth, async (req, res, next) => {
  try {
    const body = z
      .object({
        name: z.string().trim().min(2).max(120),
        externalRef: z.string().trim().max(120).optional().nullable(),
      })
      .parse(req.body);

    const store = await createStore(body.name, body.externalRef);
    res.status(201).json({
      ok: true,
      store: {
        id: store.id,
        name: store.name,
        externalRef: store.externalRef,
        createdAt: store.createdAt,
      },
      apiKey: store.apiKey,
      warning: "Store this API key now. It will not be shown again.",
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/api/admin/stores", requireAdminAuth, async (_req, res, next) => {
  try {
    const stores = await listStores();
    res.json({ ok: true, stores });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/api/admin/diagnostics", requireAdminAuth, async (req, res, next) => {
  try {
    const storeId = typeof req.query.storeId === "string" ? req.query.storeId : undefined;
    const diagnostics = await getRecentSyncDiagnostics(storeId);
    res.json({ ok: true, ...diagnostics });
  } catch (error) {
    next(error);
  }
});

/** Store-authenticated connection test used by the WooCommerce plugin. */
adminRouter.get("/api/connection/test", requireStoreAuth, async (req: AuthedRequest, res) => {
  const diagnostics = await getRecentSyncDiagnostics(req.store!.id);
  res.json({
    ok: true,
    storeId: req.store!.id,
    storeName: req.store!.name,
    timestamp: new Date().toISOString(),
    lastSuccessfulConnection: diagnostics.lastSuccessfulConnection,
  });
});
