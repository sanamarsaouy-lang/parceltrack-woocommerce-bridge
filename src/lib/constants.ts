import type { ShipmentStatus, ShippingType } from "@prisma/parceltrack-client";

/** Matches ParcelTrack STAGE_DURATION_HOURS — do not change. */
export const STAGE_DURATION_HOURS = 48;
export const TOTAL_TRANSIT_DAYS = (STAGE_DURATION_HOURS * 11) / 24;

export const STATUS_ORDER: ShipmentStatus[] = [
  "ORDER_RECEIVED",
  "PACKAGE_PREPARED",
  "PICKED_UP",
  "PROCESSING_FACILITY",
  "EXPORT_CUSTOMS",
  "DEPARTED",
  "IN_TRANSIT",
  "ARRIVED",
  "IMPORT_CUSTOMS",
  "SORTING",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
];

export type StatusMeta = {
  status: ShipmentStatus;
  order: number;
  title: string;
  description: string;
  icon: string;
  color: string;
  locationType: "origin" | "originHub" | "transit" | "destinationHub" | "destination";
};

export const STATUS_META: Record<ShipmentStatus, StatusMeta> = {
  ORDER_RECEIVED: {
    status: "ORDER_RECEIVED",
    order: 0,
    title: "Order Received",
    description: "Your shipment has been registered in our system and is awaiting preparation.",
    icon: "PackageCheck",
    color: "#64748b",
    locationType: "origin",
  },
  PACKAGE_PREPARED: {
    status: "PACKAGE_PREPARED",
    order: 1,
    title: "Package Prepared",
    description: "The package has been packed, labeled and is ready for pickup.",
    icon: "PackagePlus",
    color: "#64748b",
    locationType: "origin",
  },
  PICKED_UP: {
    status: "PICKED_UP",
    order: 2,
    title: "Picked Up",
    description: "Courier has picked up the shipment from the origin facility.",
    icon: "Truck",
    color: "#2563eb",
    locationType: "origin",
  },
  PROCESSING_FACILITY: {
    status: "PROCESSING_FACILITY",
    order: 3,
    title: "Processing Facility",
    description: "Shipment is being sorted and processed at the origin facility.",
    icon: "Warehouse",
    color: "#2563eb",
    locationType: "originHub",
  },
  EXPORT_CUSTOMS: {
    status: "EXPORT_CUSTOMS",
    order: 4,
    title: "Export Customs",
    description: "Shipment is clearing customs for export from the origin country.",
    icon: "Stamp",
    color: "#d97706",
    locationType: "originHub",
  },
  DEPARTED: {
    status: "DEPARTED",
    order: 5,
    title: "Departed",
    description: "Shipment has departed the origin country and is en route.",
    icon: "PlaneTakeoff",
    color: "#2563eb",
    locationType: "originHub",
  },
  IN_TRANSIT: {
    status: "IN_TRANSIT",
    order: 6,
    title: "In Transit",
    description: "Shipment is currently in transit between international facilities.",
    icon: "Ship",
    color: "#2563eb",
    locationType: "transit",
  },
  ARRIVED: {
    status: "ARRIVED",
    order: 7,
    title: "Arrived",
    description: "Shipment has arrived in the destination country.",
    icon: "PlaneLanding",
    color: "#2563eb",
    locationType: "destinationHub",
  },
  IMPORT_CUSTOMS: {
    status: "IMPORT_CUSTOMS",
    order: 8,
    title: "Import Customs",
    description: "Shipment is clearing customs for import into the destination country.",
    icon: "Stamp",
    color: "#d97706",
    locationType: "destinationHub",
  },
  SORTING: {
    status: "SORTING",
    order: 9,
    title: "Sorting",
    description: "Shipment is being sorted at the local distribution center.",
    icon: "Boxes",
    color: "#2563eb",
    locationType: "destinationHub",
  },
  OUT_FOR_DELIVERY: {
    status: "OUT_FOR_DELIVERY",
    order: 10,
    title: "Out For Delivery",
    description: "Shipment is on the vehicle and out for final delivery.",
    icon: "Truck",
    color: "#16a34a",
    locationType: "destination",
  },
  DELIVERED: {
    status: "DELIVERED",
    order: 11,
    title: "Delivered",
    description: "Shipment has been successfully delivered.",
    icon: "PackageCheck",
    color: "#16a34a",
    locationType: "destination",
  },
};

export const SHIPPING_TYPES: ShippingType[] = [
  "STANDARD",
  "EXPRESS",
  "AIR_FREIGHT",
  "SEA_FREIGHT",
  "ECONOMY",
];
