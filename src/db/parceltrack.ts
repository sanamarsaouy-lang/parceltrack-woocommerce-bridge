import { PrismaClient } from "@prisma/parceltrack-client";

declare global {
  // eslint-disable-next-line no-var
  var __parceltrackPrisma__: PrismaClient | undefined;
}

export const parceltrackDb =
  global.__parceltrackPrisma__ ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__parceltrackPrisma__ = parceltrackDb;
}
