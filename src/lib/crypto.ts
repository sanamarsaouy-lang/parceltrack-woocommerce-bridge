import { createHash, randomBytes, timingSafeEqual } from "crypto";

export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

export function apiKeyPrefix(apiKey: string): string {
  return apiKey.slice(0, 8);
}

export function generateApiKey(): string {
  return `ptb_${randomBytes(24).toString("base64url")}`;
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function generateCuidLike(): string {
  return `c${randomBytes(12).toString("hex")}`;
}
