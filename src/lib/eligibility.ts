/**
 * Bridge payment eligibility trust boundary.
 *
 * The Bridge cannot call WooCommerce. It therefore REQUIRES an authenticated
 * store (valid API key) to attest structured payment evidence. The Bridge:
 * - Rejects missing/invalid attestation
 * - Requires paymentConfirmedAt from the store's date_paid (never invented here)
 * - Does NOT treat orderStatus alone as proof of payment
 *
 * Limitation: a compromised store API key can forge attestations. Mitigate by
 * rotating keys, HTTPS-only plugin config, and least-privilege store keys.
 */

export type EligibilityAttestation = {
  orderStatus: string;
  paymentConfirmedAt: Date;
  paymentEvidence: "date_paid";
  attestedEligible: true;
};

const ALLOWED_BASE_STATUSES = new Set(["processing"]);

export function validateEligibilityAttestation(input: {
  orderStatus: string;
  paymentConfirmedAt: string;
  paymentEvidence: string;
  attestedEligible: boolean;
  allowedCustomPaidStatus?: string | null;
  now?: Date;
}): EligibilityAttestation {
  if (input.attestedEligible !== true) {
    throw Object.assign(new Error("attestedEligible must be true"), { statusCode: 400 });
  }
  if (input.paymentEvidence !== "date_paid") {
    throw Object.assign(
      new Error("paymentEvidence must be date_paid (WooCommerce get_date_paid)"),
      { statusCode: 400 }
    );
  }

  const status = String(input.orderStatus || "")
    .trim()
    .toLowerCase()
    .replace(/^wc-/, "");
  if (!status) {
    throw Object.assign(new Error("orderStatus is required"), { statusCode: 400 });
  }

  const custom = (input.allowedCustomPaidStatus || "")
    .trim()
    .toLowerCase()
    .replace(/^wc-/, "");
  const statusOk = ALLOWED_BASE_STATUSES.has(status) || (custom !== "" && status === custom);
  if (!statusOk) {
    throw Object.assign(
      new Error(`orderStatus "${status}" is not an allowed eligible status`),
      { statusCode: 400 }
    );
  }

  const paidAt = new Date(input.paymentConfirmedAt);
  if (Number.isNaN(paidAt.getTime())) {
    throw Object.assign(new Error("paymentConfirmedAt must be a valid ISO datetime"), {
      statusCode: 400,
    });
  }

  const now = input.now ?? new Date();
  // Reject obviously fabricated future timestamps (clock skew allowance: 5 minutes).
  if (paidAt.getTime() > now.getTime() + 5 * 60 * 1000) {
    throw Object.assign(new Error("paymentConfirmedAt cannot be in the future"), {
      statusCode: 400,
    });
  }

  return {
    orderStatus: status,
    paymentConfirmedAt: paidAt,
    paymentEvidence: "date_paid",
    attestedEligible: true,
  };
}
