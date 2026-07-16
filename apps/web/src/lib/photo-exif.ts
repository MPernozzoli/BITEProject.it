import exifr from "exifr";

export type PhotoCoordinates = {
  lat: number;
  lng: number;
};

export type PhotoMetadata = {
  coordinates: PhotoCoordinates | null;
  /** Capture instant, or null when the file carries no usable date. */
  takenAt: Date | null;
  /** Where takenAt came from, so the form can say how much to trust it. */
  takenAtSource: "gps" | "exif-offset" | "exif-local" | null;
  width: number | null;
  height: number | null;
};

const EMPTY: PhotoMetadata = {
  coordinates: null,
  takenAt: null,
  takenAtSource: null,
  width: null,
  height: null,
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isValidDate = (value: unknown): value is Date =>
  value instanceof Date && !Number.isNaN(value.getTime());

/**
 * The project resolves voyages on Europe/Rome windows (resolve_voyage_for_timestamp),
 * so a naked DateTimeOriginal — which carries no zone — is read in that zone. Photos
 * shot abroad can land up to a couple of hours off, which only matters within a few
 * hours of a voyage boundary; the admin form shows the resolved voyage and lets it be
 * overridden, which is the backstop for exactly that case.
 */
const ROME_TIME_ZONE = "Europe/Rome";

/** Offset in minutes between the given instant and Europe/Rome, DST included. */
const romeOffsetMinutes = (utcDate: Date): number => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: ROME_TIME_ZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(utcDate).map((part) => [part.type, part.value])
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    // Intl renders midnight as hour 24 in some engines.
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );
  return (asUtc - utcDate.getTime()) / 60000;
};

/**
 * Reinterprets the wall-clock reading of `date` as Europe/Rome rather than the browser's
 * zone. exifr parses DateTimeOriginal into a Date using the local zone, which is wrong
 * whenever the editor's laptop is not on Rome time.
 */
const reinterpretAsRome = (date: Date): Date => {
  const wallClockAsUtc = Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds()
  );
  // Two passes: the offset depends on the instant, which depends on the offset.
  const firstPass = new Date(wallClockAsUtc - romeOffsetMinutes(new Date(wallClockAsUtc)) * 60000);
  return new Date(wallClockAsUtc - romeOffsetMinutes(firstPass) * 60000);
};

/** Builds the capture instant from GPSDateStamp + GPSTimeStamp, which are already UTC. */
const fromGpsStamps = (gpsDateStamp: unknown, gpsTimeStamp: unknown): Date | null => {
  if (typeof gpsDateStamp !== "string") return null;
  const dateMatch = gpsDateStamp.match(/^(\d{4})[:-](\d{2})[:-](\d{2})$/);
  if (!dateMatch) return null;
  const [, year, month, day] = dateMatch;

  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  if (Array.isArray(gpsTimeStamp) && gpsTimeStamp.length >= 3) {
    const [h, m, s] = gpsTimeStamp;
    if (!isFiniteNumber(h) || !isFiniteNumber(m) || !isFiniteNumber(s)) return null;
    hours = h;
    minutes = m;
    seconds = Math.round(s);
  } else {
    return null;
  }

  const instant = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), hours, minutes, seconds)
  );
  return isValidDate(instant) ? instant : null;
};

/**
 * Reads the coordinates and capture date a photo carries.
 *
 * Timestamp preference, best first:
 *  1. GPS date/time stamps — recorded in UTC by the receiver, no zone guessing;
 *  2. DateTimeOriginal + OffsetTimeOriginal — the camera told us its zone;
 *  3. DateTimeOriginal alone — read as Europe/Rome.
 *
 * Never throws: a file with stripped metadata, an unreadable header or an unsupported
 * container all return empty fields, and the caller falls back to a manual pin.
 */
export const readPhotoMetadata = async (file: File): Promise<PhotoMetadata> => {
  try {
    const parsed = await exifr.parse(file, {
      gps: true,
      tiff: true,
      exif: true,
      pick: [
        "latitude",
        "longitude",
        "GPSDateStamp",
        "GPSTimeStamp",
        "DateTimeOriginal",
        "CreateDate",
        "OffsetTimeOriginal",
        "ExifImageWidth",
        "ExifImageHeight",
        "ImageWidth",
        "ImageHeight",
      ],
    });

    if (!parsed) return EMPTY;

    const lat = parsed.latitude;
    const lng = parsed.longitude;
    const hasCoordinates =
      isFiniteNumber(lat) &&
      isFiniteNumber(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180 &&
      // A 0,0 fix is Null Island: in practice a failed lock, not the Gulf of Guinea.
      !(lat === 0 && lng === 0);

    let takenAt: Date | null = null;
    let takenAtSource: PhotoMetadata["takenAtSource"] = null;

    const gpsInstant = fromGpsStamps(parsed.GPSDateStamp, parsed.GPSTimeStamp);
    if (gpsInstant) {
      takenAt = gpsInstant;
      takenAtSource = "gps";
    } else {
      const original = isValidDate(parsed.DateTimeOriginal)
        ? parsed.DateTimeOriginal
        : isValidDate(parsed.CreateDate)
          ? parsed.CreateDate
          : null;
      if (original) {
        // exifr surfaces the offset as a string like "+02:00" when the camera wrote it.
        const offsetMatch =
          typeof parsed.OffsetTimeOriginal === "string"
            ? parsed.OffsetTimeOriginal.match(/^([+-])(\d{2}):(\d{2})$/)
            : null;
        if (offsetMatch) {
          const [, sign, hh, mm] = offsetMatch;
          const offsetMinutes =
            (sign === "-" ? -1 : 1) * (Number(hh) * 60 + Number(mm));
          const wallClockAsUtc = Date.UTC(
            original.getFullYear(),
            original.getMonth(),
            original.getDate(),
            original.getHours(),
            original.getMinutes(),
            original.getSeconds()
          );
          takenAt = new Date(wallClockAsUtc - offsetMinutes * 60000);
          takenAtSource = "exif-offset";
        } else {
          takenAt = reinterpretAsRome(original);
          takenAtSource = "exif-local";
        }
      }
    }

    const width = isFiniteNumber(parsed.ExifImageWidth)
      ? parsed.ExifImageWidth
      : isFiniteNumber(parsed.ImageWidth)
        ? parsed.ImageWidth
        : null;
    const height = isFiniteNumber(parsed.ExifImageHeight)
      ? parsed.ExifImageHeight
      : isFiniteNumber(parsed.ImageHeight)
        ? parsed.ImageHeight
        : null;

    return {
      coordinates: hasCoordinates ? { lat, lng } : null,
      takenAt,
      takenAtSource,
      width,
      height,
    };
  } catch (error) {
    console.warn("Could not read photo metadata", error);
    return EMPTY;
  }
};

/** Falls back to the file's own mtime, the last date available once EXIF has nothing. */
export const fallbackTakenAt = (file: File): Date | null => {
  const modified = new Date(file.lastModified);
  return isValidDate(modified) ? modified : null;
};
