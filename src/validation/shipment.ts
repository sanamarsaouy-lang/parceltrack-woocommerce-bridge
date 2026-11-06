import { z } from "zod";

export const eligibilityAttestationSchema = z.object({
  orderStatus: z.string().trim().min(1).max(64),
  /** Must be WooCommerce date_paid — never fabricated as "now". */
  paymentConfirmedAt: z.string().datetime(),
  paymentEvidence: z.literal("date_paid"),
  attestedEligible: z.literal(true),
  /** Optional custom Paid slug configured in the plugin (without wc- prefix). */
  customPaidStatus: z.string().trim().max(64).optional().nullable(),
});

export const createShipmentBodySchema = z.object({
  orderId: z.union([z.string(), z.number()]).transform((v) => String(v).trim()),
  buyerName: z.string().trim().min(2).max(120),
  buyerEmail: z.string().trim().email().optional().nullable(),
  originCountry: z.string().trim().min(2).max(80),
  destinationCountry: z.string().trim().min(2).max(80),
  destinationAddress: z.string().trim().min(4).max(300),
  shippingMethod: z.string().trim().max(120).optional().nullable(),
  shippingType: z
    .enum(["STANDARD", "EXPRESS", "AIR_FREIGHT", "SEA_FREIGHT", "ECONOMY"])
    .default("STANDARD"),
  weightKg: z.number().positive().max(10000).optional().nullable(),
  /** Informational only — never used as ParcelTrack shippingDate. */
  orderCreatedAt: z.string().datetime().optional().nullable(),
  /**
   * Intended dispatch / shipment creation time for the 48h timeline.
   * Defaults to Bridge receive time when omitted.
   */
  shippingDate: z.string().datetime().optional().nullable(),
  estimatedDeliveryDays: z.number().int().min(1).max(120).optional().nullable(),
  estimatedDeliveryDate: z.string().datetime().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  mode: z.enum(["test", "live", "manual"]).optional().nullable(),
  eligibility: eligibilityAttestationSchema,
});

export type CreateShipmentBody = z.infer<typeof createShipmentBodySchema>;
