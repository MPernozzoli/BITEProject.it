import type { Language } from "@/lib/i18n";

export type VoyageBookingStatus =
  | "requested"
  | "waitlisted"
  | "admin_approved"
  | "user_confirmed"
  | "cancelled"
  | "rejected"
  | "expired";

export interface BookingVoyage {
  id: string;
  name: string;
  name_it: string | null;
  name_en: string | null;
  status: "planned" | "active" | "completed";
  booking_enabled?: boolean;
  booking_max_guests?: number;
  start_date: string | null;
  end_date: string | null;
}

export interface BookingWaypoint {
  id: string;
  voyage_id: string;
  name: string | null;
  name_it: string | null;
  name_en: string | null;
  sort_order: number;
  date_start: string | null;
  date_end: string | null;
}

export interface BookableLeg {
  id: string;
  voyage_id: string;
  from_waypoint_id: string;
  to_waypoint_id: string;
  sort_order: number;
  starts_at_window_start: string | null;
  starts_at_window_end: string | null;
  ends_at_window_start: string | null;
  ends_at_window_end: string | null;
  is_bookable: boolean;
}

export interface BookingRequest {
  id: string;
  voyage_id: string;
  profile_id: string;
  party_size: number;
  status: VoyageBookingStatus;
  message: string | null;
  admin_notes: string | null;
  requested_at: string;
  expires_at: string | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  updated_at: string;
}

export interface BookingRequestLeg {
  booking_request_id: string;
  bookable_leg_id: string;
}

export interface BookingProfile {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
}

export interface BookingSettings {
  voyage_id: string;
  confirmation_deadline_hours: number;
  predeparture_info_it: string | null;
  predeparture_info_en: string | null;
  briefing_content_it: string | null;
  briefing_content_en: string | null;
  terms_content_it: string | null;
  terms_content_en: string | null;
}

export interface BookingTask {
  id: string;
  voyage_id: string;
  title_it: string;
  title_en: string | null;
  description_it: string | null;
  description_en: string | null;
  required: boolean;
  sort_order: number;
}

export interface BookingTaskCompletion {
  booking_request_id: string;
  task_id: string;
  completed_at: string;
}

const statusClassMap: Record<VoyageBookingStatus, string> = {
  requested: "border-amber-300/70 bg-amber-100/70 text-amber-800",
  waitlisted: "border-sky-300/70 bg-sky-100/75 text-sky-800",
  admin_approved: "border-yellow-300/70 bg-yellow-100/75 text-yellow-800",
  user_confirmed: "border-emerald-300/75 bg-emerald-100/80 text-emerald-800",
  cancelled: "border-red-300/70 bg-red-100/75 text-red-800",
  rejected: "border-red-300/70 bg-red-100/75 text-red-800",
  expired: "border-stone-300/70 bg-stone-100/80 text-stone-700",
};

export const capacityBlockingStatuses = new Set<VoyageBookingStatus>([
  "requested",
  "admin_approved",
  "user_confirmed",
]);

export function getBookingStatusLabel(status: VoyageBookingStatus, lang: Language | "it" | "en" = "it") {
  const italian = lang === "it";
  const labels: Record<VoyageBookingStatus, string> = {
    requested: italian ? "Prenotato" : "Requested",
    waitlisted: italian ? "Waiting list" : "Waitlisted",
    admin_approved: italian ? "Da confermare" : "Ready to confirm",
    user_confirmed: italian ? "Confermato" : "Confirmed",
    cancelled: italian ? "Annullato" : "Cancelled",
    rejected: italian ? "Rifiutato" : "Rejected",
    expired: italian ? "Scaduto" : "Expired",
  };
  return labels[status];
}

export function getBookingStatusClass(status: VoyageBookingStatus) {
  return statusClassMap[status];
}

export function getBookingStatusShortLabel(status: VoyageBookingStatus) {
  const labels: Record<VoyageBookingStatus, string> = {
    requested: "REQ",
    waitlisted: "WAIT",
    admin_approved: "OK?",
    user_confirmed: "CONF",
    cancelled: "CANC",
    rejected: "NO",
    expired: "EXP",
  };
  return labels[status];
}

export function getLocalizedBookingVoyageName(voyage: BookingVoyage | null | undefined, lang: Language | "it" | "en") {
  if (!voyage) return "";
  return lang === "it"
    ? voyage.name_it || voyage.name_en || voyage.name
    : voyage.name_en || voyage.name_it || voyage.name;
}

export function getLocalizedBookingWaypointName(
  waypoint: BookingWaypoint | null | undefined,
  lang: Language | "it" | "en"
) {
  if (!waypoint) return "";
  return lang === "it"
    ? waypoint.name_it || waypoint.name_en || waypoint.name || "Waypoint"
    : waypoint.name_en || waypoint.name_it || waypoint.name || "Waypoint";
}

export function formatBookingDate(value?: string | null, locale = "it-IT") {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function getLegEffectiveDate(leg: BookableLeg) {
  return leg.starts_at_window_end || leg.starts_at_window_start || leg.ends_at_window_end || leg.ends_at_window_start || null;
}

export function isLegCurrentOrFuture(leg: BookableLeg) {
  const value = getLegEffectiveDate(leg);
  if (!value) return true;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return true;
  const today = new Date();
  const currentDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const legDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return legDay >= currentDay;
}

export function isLegSelectable(leg: BookableLeg) {
  return leg.is_bookable && isLegCurrentOrFuture(leg);
}

export function getLegLabel(
  leg: BookableLeg,
  waypointsById: Record<string, BookingWaypoint>,
  lang: Language | "it" | "en"
) {
  const from = getLocalizedBookingWaypointName(waypointsById[leg.from_waypoint_id], lang);
  const to = getLocalizedBookingWaypointName(waypointsById[leg.to_waypoint_id], lang);
  return `${from} → ${to}`;
}
