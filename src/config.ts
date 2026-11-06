function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT || 3001),
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: () => required("DATABASE_URL"),
  directUrl: () => required("DIRECT_URL"),
  metaDatabaseUrl: () => required("BRIDGE_META_DATABASE_URL"),
  adminApiKey: () => required("BRIDGE_ADMIN_API_KEY"),
  bootstrapStoreName: process.env.BRIDGE_BOOTSTRAP_STORE_NAME?.trim() || "",
  bootstrapStoreKey: process.env.BRIDGE_BOOTSTRAP_STORE_KEY?.trim() || "",
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 60),
  leaseMs: Number(process.env.IDEMPOTENCY_LEASE_MS || 60_000),
};
