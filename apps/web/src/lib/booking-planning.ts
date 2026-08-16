import { formatBookingDate, type BookableLeg, type BookingWaypoint } from "@/lib/booking-utils";

/**
 * Helper puri di pianificazione rotta dell'admin booking: formattazione date/durate/distanze e
 * matematica arrivo → sosta → ripartenza. Vivevano come funzioni module-private dentro
 * `pages/AdminVoyageBookings.tsx`; stanno qui perché i pannelli estratti in `components/admin/`
 * ne hanno bisogno, e un componente non deve importare da una pagina.
 * Nessuna dipendenza da stato React: input → output.
 */

export const formatPlanningDate = (value?: string | null) => {
  if (!value) return "Non impostata";
  return formatBookingDate(value, "it-IT") || "Non impostata";
};

export const formatDuration = (minutes: number) => {
  const safeMinutes = Math.max(0, Math.round(minutes || 0));
  const days = Math.floor(safeMinutes / 1440);
  const hours = Math.floor((safeMinutes % 1440) / 60);
  const mins = safeMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days}g`);
  if (hours) parts.push(`${hours}h`);
  if (mins || parts.length === 0) parts.push(`${mins}m`);
  return parts.join(" ");
};

export const haversineNm = (from: BookingWaypoint | undefined, to: BookingWaypoint | undefined) => {
  if (typeof from?.lat !== "number" || typeof from?.lng !== "number" || typeof to?.lat !== "number" || typeof to?.lng !== "number") {
    return null;
  }
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 3440.065 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const hasWaypointCoordinates = (
  waypoint: BookingWaypoint
): waypoint is BookingWaypoint & { lat: number; lng: number } =>
  Number.isFinite(Number(waypoint.lat)) && Number.isFinite(Number(waypoint.lng));

export const formatPlanningWindow = (start?: string | null, end?: string | null) => {
  if (!start && !end) return "Non impostata";
  if (start && end && start !== end) return `${formatPlanningDate(start)} → ${formatPlanningDate(end)}`;
  return formatPlanningDate(start || end);
};

export const formatWaypointStopTiming = (
  waypoint: BookingWaypoint,
  incomingLeg?: BookableLeg,
  outboundLeg?: BookableLeg
) => {
  const arrival = waypoint.date_end
    ? formatPlanningDate(waypoint.date_end)
    : formatPlanningWindow(incomingLeg?.ends_at_window_start, incomingLeg?.ends_at_window_end);
  const departure = waypoint.date_start
    ? formatPlanningDate(waypoint.date_start)
    : formatPlanningWindow(outboundLeg?.starts_at_window_start, outboundLeg?.starts_at_window_end);
  return `Arrivo ${arrival} · Ripartenza ${departure}`;
};

export const formatLegDistance = (distanceNm: number | null | undefined) => {
  if (!Number.isFinite(Number(distanceNm))) return "NM non disponibili";
  return `${Number(distanceNm).toFixed(1)} NM`;
};

export const getWaypointArrivalDate = (waypoint: BookingWaypoint, incomingLeg?: BookableLeg) => {
  const value = waypoint.date_end || incomingLeg?.ends_at_window_start || incomingLeg?.ends_at_window_end;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatLocalTime = (date: Date) =>
  `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

export const isDepartureTimeAfterArrival = (arrival: Date | null, departureTime: string) => {
  if (!arrival || !departureTime) return true;
  const [hoursPart, minutesPart] = departureTime.split(":");
  const hours = Number(hoursPart);
  const minutes = Number(minutesPart);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return true;
  const departure = new Date(arrival);
  departure.setHours(hours, minutes, 0, 0);
  return departure.getTime() > arrival.getTime();
};

export const getDepartureTimeFromArrivalAndHours = (arrival: Date | null, hours: number) => {
  if (!arrival) return null;
  const departure = new Date(arrival.getTime() + Math.max(0, Number(hours) || 0) * 3_600_000);
  return departure.toDateString() === arrival.toDateString() ? formatLocalTime(departure) : null;
};

export const getStopHoursFromArrivalAndDepartureTime = (arrival: Date | null, departureTime: string) => {
  if (!arrival || !departureTime) return null;
  const [hoursPart, minutesPart] = departureTime.split(":");
  const hours = Number(hoursPart);
  const minutes = Number(minutesPart);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  const departure = new Date(arrival);
  departure.setHours(hours, minutes, 0, 0);
  if (departure.getTime() <= arrival.getTime()) return null;
  const diffHours = (departure.getTime() - arrival.getTime()) / 3_600_000;
  return Math.max(0, Math.round(diffHours));
};

export const toDateTimeLocalValue = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

export const fromDateTimeLocalValue = (value: string) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
