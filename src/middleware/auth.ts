import type { Request, Response, NextFunction } from "express";
import { config } from "../config";
import { findStoreByApiKey, type AuthenticatedStore } from "../lib/store-service";
import { hashApiKey, safeEqualHex } from "../lib/crypto";

export type AuthedRequest = Request & {
  store?: AuthenticatedStore;
};

function extractBearer(req: Request): string | null {
  const header = req.header("authorization") || req.header("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

export async function requireStoreAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const token = extractBearer(req);
    if (!token) {
      return res.status(401).json({ error: "Missing Bearer API key" });
    }
    const store = await findStoreByApiKey(token);
    if (!store) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    req.store = store;
    return next();
  } catch (error) {
    return next(error);
  }
}

export function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = extractBearer(req);
    if (!token) {
      return res.status(401).json({ error: "Missing admin API key" });
    }
    const expected = config.adminApiKey();
    if (!safeEqualHex(hashApiKey(token), hashApiKey(expected))) {
      return res.status(401).json({ error: "Invalid admin API key" });
    }
    return next();
  } catch (error) {
    return next(error);
  }
}
