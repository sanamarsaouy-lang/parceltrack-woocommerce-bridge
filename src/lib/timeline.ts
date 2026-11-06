import type { ShipmentStatus } from "@prisma/parceltrack-client";
import { STAGE_DURATION_HOURS, STATUS_META, STATUS_ORDER } from "./constants";

type LocationInputs = {
  originCountry: string;
  destinationCountry: string;
  destinationAddress: string;
};

function locationForStatus(
  locationType: (typeof STATUS_META)[ShipmentStatus]["locationType"],
  { originCountry, destinationCountry, destinationAddress }: LocationInputs
): string {
  switch (locationType) {
    case "origin":
      return `${originCountry} Origin Facility`;
    case "originHub":
      return `${originCountry} International Hub`;
    case "transit":
      return "International Transit Hub";
    case "destinationHub":
      return `${destinationCountry} International Hub`;
    case "destination":
      return destinationAddress || `${destinationCountry} Local Facility`;
    default:
      return destinationCountry;
  }
}

export type TimelineEventDraft = {
  status: ShipmentStatus;
  order: number;
  title: string;
  description: string;
  location: string;
  icon: string;
  color: string;
  occursAt: Date;
  isCompleted: boolean;
};

/** Compatible with ParcelTrack buildInitialTimeline (48-hour stage intervals). */
export function buildInitialTimeline(
  shippingDate: Date,
  locationInputs: LocationInputs,
  currentStatusIndex = 0
): TimelineEventDraft[] {
  return STATUS_ORDER.map((status, index) => {
    const meta = STATUS_META[status];
    const occursAt = new Date(
      shippingDate.getTime() + index * STAGE_DURATION_HOURS * 60 * 60 * 1000
    );
    return {
      status,
      order: meta.order,
      title: meta.title,
      description: meta.description,
      location: locationForStatus(meta.locationType, locationInputs),
      icon: meta.icon,
      color: meta.color,
      occursAt,
      isCompleted: index <= currentStatusIndex,
    };
  });
}
