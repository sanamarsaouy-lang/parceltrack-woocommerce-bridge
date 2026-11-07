
import { metaDb } from "../db/meta";
import { apiKeyPrefix, generateApiKey, hashApiKey, safeEqualHex } from "./crypto";
import { config } from "../config";

export type AuthenticatedStore = {
  id: string;
  name: string;
};

export async function findStoreByApiKey(apiKey: string): Promise<AuthenticatedStore | null> {
  if (!apiKey || apiKey.length < 16) return null;
  const prefix = apiKeyPrefix(apiKey);
  const candidates = await metaDb.store.findMany({
    where: { apiKeyPrefix: prefix, isActive: true },
    select: { id: true, name: true, apiKeyHash: true },
  });
  const hash = hashApiKey(apiKey);
  for (const store of candidates) {
    if (safeEqualHex(store.apiKeyHash, hash)) {
      return { id: store.id, name: store.name };
    }
  }
  return null;
}

export async function createStore(name: string, externalRef?: string | null) {
  const apiKey = generateApiKey();
  const store = await metaDb.store.create({
    data: {
      name: name.trim(),
      externalRef: externalRef?.trim() || null,
      apiKeyHash: hashApiKey(apiKey),
      apiKeyPrefix: apiKeyPrefix(apiKey),
    },
  });
  return {
    id: store.id,
    name: store.name,
    externalRef: store.externalRef,
    apiKey,
    createdAt: store.createdAt,
  };
}

export async function rotateStoreApiKey(storeId: string) {
  const apiKey = generateApiKey();

  const updated = await metaDb.store.updateMany({
    where: { id: storeId, isActive: true },
    data: {
      apiKeyHash: hashApiKey(apiKey),
      apiKeyPrefix: apiKeyPrefix(apiKey),
    },
  });

  if (updated.count !== 1) return null;

  return { storeId, apiKey };
}

export async function listStores() {
  return metaDb.store.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      externalRef: true,
      apiKeyPrefix: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function ensureBootstrapStore() {
  const key = config.bootstrapStoreKey;
  const name = config.bootstrapStoreName || "Primary WooCommerce Store";
  if (!key) return null;

  const hash = hashApiKey(key);
  const existing = await metaDb.store.findFirst({
    where: { apiKeyHash: hash },
  });
  if (existing) return existing;

  return metaDb.store.create({
    data: {
      name,
      externalRef: "bootstrap",
      apiKeyHash: hash,
      apiKeyPrefix: apiKeyPrefix(key),
    },
  });
}

export async function getRecentSyncDiagnostics(storeId?: string) {
  const where = storeId ? { storeId } : {};
  const [successes, failures, lastSuccess] = await Promise.all([
    metaDb.syncEvent.findMany({
      where: { ...where, success: true },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        storeId: true,
        wooOrderId: true,
        trackingNumber: true,
        message: true,
        mode: true,
        createdAt: true,
      },
    }),
    metaDb.syncEvent.findMany({
      where: { ...where, success: false },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        storeId: true,
        wooOrderId: true,
        trackingNumber: true,
        message: true,
        mode: true,
        createdAt: true,
      },
    }),
    metaDb.syncEvent.findFirst({
      where: { ...where, success: true },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  return {
    lastSuccessfulConnection: lastSuccess?.createdAt ?? null,
    recentSuccessfulShipments: successes,
    recentErrors: failures,
  };
}
