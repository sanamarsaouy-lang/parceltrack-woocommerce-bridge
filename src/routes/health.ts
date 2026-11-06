import { Router } from "express";
import { metaDb } from "../db/meta";
import { parceltrackDb } from "../db/parceltrack";

export const healthRouter = Router();

healthRouter.get("/health", async (_req, res, next) => {
  try {
    await Promise.all([
      parceltrackDb.$queryRaw`SELECT 1`,
      metaDb.$queryRaw`SELECT 1`,
    ]);
    res.json({
      ok: true,
      service: "parceltrack-bridge-api",
      timestamp: new Date().toISOString(),
      databases: {
        parceltrack: "ok",
        bridgeMeta: "ok",
      },
    });
  } catch (error) {
    next(error);
  }
});
