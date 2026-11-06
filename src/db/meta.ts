import { PrismaClient } from "@prisma/bridge-meta-client";

declare global {
  // eslint-disable-next-line no-var
  var __bridgeMetaPrisma__: PrismaClient | undefined;
}

export const metaDb =
  global.__bridgeMetaPrisma__ ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__bridgeMetaPrisma__ = metaDb;
}
