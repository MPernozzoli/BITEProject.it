import type { Tables, TablesInsert } from "@/integrations/supabase/types";

export const mapPresenceTrackerIds = ["boat", "crew"] as const;

export type MapPresenceTrackerId = (typeof mapPresenceTrackerIds)[number];
export type MapPresenceTrackerRow = Tables<"logbook_map_markers">;
export type MapPresenceTrackerInsert = TablesInsert<"logbook_map_markers">;
export type MapPresenceMarkerKind = "boat" | "boat-aboard" | "crew";

export interface MapPresenceMarker {
  id: MapPresenceTrackerId;
  kind: MapPresenceMarkerKind;
  latitude: number;
  longitude: number;
  title: string;
  description: string | null;
  updatedAt: string;
}

export const getMapPresenceIconMarkup = (kind: MapPresenceMarkerKind) => {
  if (kind === "crew") {
    return `
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="24" cy="24" r="7" fill="currentColor" />
        <circle cx="40" cy="24" r="7" fill="currentColor" opacity="0.92" />
        <path d="M16 46c0-6 5-11 11-11h10c6 0 11 5 11 11v2H16z" fill="currentColor" />
      </svg>
    `;
  }

  if (kind === "boat-aboard") {
    return `
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M14 39h8l9-18 8 11h11l-5 7H20l-6 9-4-4z" fill="currentColor" opacity="0.96" />
        <path d="M31 21v18" stroke="currentColor" stroke-width="4" stroke-linecap="round" />
        <path d="M31 23l10 9H31z" fill="currentColor" />
        <circle cx="22" cy="28" r="3.2" fill="currentColor" />
        <circle cx="29" cy="25.5" r="3.2" fill="currentColor" />
        <circle cx="36" cy="28" r="3.2" fill="currentColor" />
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M14 41h10l11-19 9 12h9l-6 8H19l-5 8-4-5z" fill="currentColor" opacity="0.96" />
      <path d="M35 22v20" stroke="currentColor" stroke-width="4" stroke-linecap="round" />
      <path d="M35 24l11 10H35z" fill="currentColor" />
    </svg>
  `;
};

const trackerDefaults: Record<MapPresenceTrackerId, Omit<MapPresenceTrackerInsert, "updated_at" | "updated_by">> = {
  boat: {
    id: "boat",
    label_it: "Spritz",
    label_en: "Spritz",
    description_it: "Posizione manuale della barca sulla mappa del logbook.",
    description_en: "Manual boat position shown on the logbook map.",
    is_visible: true,
    is_onboard: false,
    latitude: null,
    longitude: null,
  },
  crew: {
    id: "crew",
    label_it: "Equipaggio",
    label_en: "Crew",
    description_it: "Posizione manuale dell'equipaggio quando non e a bordo.",
    description_en: "Manual crew position when not onboard.",
    is_visible: true,
    is_onboard: false,
    latitude: null,
    longitude: null,
  },
};

const trackerFallbackCopy = {
  boat: {
    it: {
      title: "Spritz",
      description: "Posizione manuale della barca sulla mappa del logbook.",
      onboardNote: "Equipaggio a bordo.",
    },
    en: {
      title: "Spritz",
      description: "Manual boat position shown on the logbook map.",
      onboardNote: "Crew onboard.",
    },
  },
  crew: {
    it: {
      title: "Equipaggio",
      description: "Posizione manuale dell'equipaggio quando non e a bordo.",
    },
    en: {
      title: "Crew",
      description: "Manual crew position when not onboard.",
    },
  },
} as const;

const hasCoordinates = (latitude: number | null, longitude: number | null) =>
  Number.isFinite(latitude) && Number.isFinite(longitude);

const localizedTrackerValue = (
  tracker: Pick<MapPresenceTrackerRow, "id" | "label_it" | "label_en" | "description_it" | "description_en">,
  field: "label" | "description",
  lang: "it" | "en"
) => {
  const localizedValue =
    field === "label"
      ? lang === "it"
        ? tracker.label_it
        : tracker.label_en
      : lang === "it"
        ? tracker.description_it
        : tracker.description_en;

  const fallbackValue =
    field === "label"
      ? trackerFallbackCopy[tracker.id][lang].title
      : trackerFallbackCopy[tracker.id][lang].description;

  const trimmedValue = localizedValue?.trim();
  return trimmedValue || fallbackValue;
};

export const createDefaultMapPresenceTracker = (id: MapPresenceTrackerId): MapPresenceTrackerRow => ({
  ...trackerDefaults[id],
  label_it: trackerDefaults[id].label_it ?? "",
  label_en: trackerDefaults[id].label_en ?? "",
  updated_at: new Date().toISOString(),
  updated_by: null,
} as MapPresenceTrackerRow);

export const mergeMapPresenceTrackers = (rows: MapPresenceTrackerRow[]) => {
  const trackerMap = {
    boat: createDefaultMapPresenceTracker("boat"),
    crew: createDefaultMapPresenceTracker("crew"),
  } satisfies Record<MapPresenceTrackerId, MapPresenceTrackerRow>;

  rows.forEach((row) => {
    if (row.id === "boat" || row.id === "crew") {
      trackerMap[row.id] = {
        ...trackerMap[row.id],
        ...row,
      };
    }
  });

  return trackerMap;
};

export const buildMapPresenceMarkers = (
  rows: MapPresenceTrackerRow[],
  lang: "it" | "en"
): MapPresenceMarker[] => {
  const trackerMap = mergeMapPresenceTrackers(rows);
  const boat = trackerMap.boat;
  const crew = trackerMap.crew;
  const markers: MapPresenceMarker[] = [];

  if (boat.is_visible && hasCoordinates(boat.latitude, boat.longitude)) {
    const boatDescriptionParts = [localizedTrackerValue(boat, "description", lang)];
    if (crew.is_onboard) {
      boatDescriptionParts.push(trackerFallbackCopy.boat[lang].onboardNote);
    }

    markers.push({
      id: "boat",
      kind: crew.is_onboard ? "boat-aboard" : "boat",
      latitude: boat.latitude!,
      longitude: boat.longitude!,
      title: localizedTrackerValue(boat, "label", lang),
      description: boatDescriptionParts.filter(Boolean).join(" "),
      updatedAt: boat.updated_at,
    });
  }

  if (crew.is_visible && !crew.is_onboard && hasCoordinates(crew.latitude, crew.longitude)) {
    markers.push({
      id: "crew",
      kind: "crew",
      latitude: crew.latitude!,
      longitude: crew.longitude!,
      title: localizedTrackerValue(crew, "label", lang),
      description: localizedTrackerValue(crew, "description", lang),
      updatedAt: crew.updated_at,
    });
  }

  return markers;
};

export const buildMapPresenceUpsertPayload = (
  id: MapPresenceTrackerId,
  values: Partial<MapPresenceTrackerInsert> & Pick<MapPresenceTrackerInsert, "label_it" | "label_en">
): MapPresenceTrackerInsert => ({
  ...trackerDefaults[id],
  ...values,
  id,
});
