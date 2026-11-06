import { parceltrackDb } from "../db/parceltrack";
import { metaDb } from "../db/meta";

/** Same alphabet as ParcelTrack — no O/0/I/1 ambiguity. */
export const TRACKING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomSegment(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += TRACKING_ALPHABET[Math.floor(Math.random() * TRACKING_ALPHABET.length)];
  }
  return out;
}

/**
 * Strict ParcelTrack format: TRK- + exactly 8 chars from the ambiguity-safe alphabet.
 */
export function isValidTrackingNumberFormat(value: string): boolean {
  const v = value.trim().toUpperCase();
  if (!/^TRK-[A-Z0-9]{8}$/.test(v)) return false;
  const body = v.slice(4);
  for (const ch of body) {
    if (!TRACKING_ALPHABET.includes(ch)) return false;
  }
  return true;
}

/**
 * Generates a tracking number unused in both ParcelTrack and Bridge metadata.
 */
export async function generateUniqueTrackingNumber(): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const candidate = `TRK-${randomSegment(8)}`;
    const [inParceltrack, inMeta] = await Promise.all([
      parceltrackDb.shipment.findUnique({
        where: { trackingNumber: candidate },
        select: { id: true },
      }),
      metaDb.idempotencyRecord.findUnique({
        where: { trackingNumber: candidate },
        select: { id: true },
      }),
    ]);
    if (!inParceltrack && !inMeta) return candidate;
  }
  throw new Error("Failed to generate a unique tracking number after multiple attempts.");
}
