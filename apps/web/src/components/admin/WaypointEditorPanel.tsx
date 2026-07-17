import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, MapPin, Trash2 } from "lucide-react";
import {
  buildWaypointDefaultLocalizedNames,
  formatWaypointCoordinateLabel,
  getWaypointEffectiveType,
  getWaypointSequenceHeading,
  reverseGeocodePlaceLocalized,
  type VoyageWaypoint,
  type VoyageWaypointMediaItem,
} from "@/lib/voyage-utils";
import { STOP_DEPARTURE_PRESETS } from "@/lib/booking-utils";
import { invokeTranslateEditorContent } from "@/lib/translate-editor-content";
import type { Language } from "@/lib/language";
import {
  buildWaypointFormState,
  computeWaypointFormChanges,
  type VisibilityChoice,
  type StopUiMode,
  type WaypointFormState,
} from "@/lib/waypoint-form";

type MaritimeMode = "auto" | "city" | "maritime";

export type WaypointUpdateOptions = { successMessage?: string | null; syncGeometry?: boolean };

export interface WaypointEditorPanelProps {
  waypoint: VoyageWaypoint;
  index: number;
  total: number;
  lang: Language;
  voyageType: "water" | "land";
  datesTbd: boolean;
  /** Pre-computed hints/placeholders from the parent's schedule suggestions. */
  arrivalNote: string | null;
  departureNote: string | null;
  arrivalPlaceholder: string;
  departurePlaceholder: string;
  legEstimateLabel: string | null;
  onUpdate: (changes: Partial<VoyageWaypoint>, options?: WaypointUpdateOptions) => Promise<boolean>;
  onDelete: () => void;
  onRelocate: () => void;
  onUploadMedia: (files: File[]) => Promise<VoyageWaypointMediaItem[]>;
  onDeleteMedia: (item: VoyageWaypointMediaItem) => Promise<void>;
}


const labelClass = "block text-[10px] font-sans font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-1.5";
const inputClass =
  "w-full px-2.5 py-2 border border-border bg-background text-sm font-sans text-foreground outline-none focus:border-foreground/40 transition-colors";
const sectionClass = "grid gap-2.5 p-3 border border-border bg-background/60";
const sectionTitleClass = "m-0 text-[10px] font-sans font-bold uppercase tracking-[0.14em] text-muted-foreground";
const chipClass =
  "px-2.5 py-1 border border-border bg-background text-foreground text-[11px] font-sans font-semibold rounded-full cursor-pointer hover:bg-muted transition-colors";
const segmentGroupClass = "grid gap-1.5";
const segmentButtonClass =
  "w-full px-2.5 py-2 border border-border bg-background text-left text-[11px] font-sans font-semibold text-foreground cursor-pointer hover:bg-muted transition-colors";
const activeSegmentButtonClass = "border-primary bg-primary text-primary-foreground hover:bg-primary/90";

const visibilityChoices: Array<{ value: VisibilityChoice; label: string }> = [
  { value: "auto", label: "Auto (start/end pubblici)" },
  { value: "technical", label: "Tecnico / nascosto" },
  { value: "narrative", label: "Narrativo / pubblico" },
];

const maritimeChoices: Array<{ value: MaritimeMode; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "city", label: "Citta / porto" },
  { value: "maritime", label: "Baia / cala" },
];

const stopModeChoices: Array<{ value: StopUiMode; label: string }> = [
  { value: "none", label: "Nessuna sosta" },
  { value: "hours", label: "Sosta breve" },
  { value: "nights", label: "Giorni + orario" },
];

const WaypointEditorPanel = ({
  waypoint,
  index,
  total,
  lang,
  voyageType,
  datesTbd,
  arrivalNote,
  departureNote,
  arrivalPlaceholder,
  departurePlaceholder,
  legEstimateLabel,
  onUpdate,
  onDelete,
  onRelocate,
  onUploadMedia,
  onDeleteMedia,
}: WaypointEditorPanelProps) => {
  const [form, setForm] = useState<WaypointFormState>(() => buildWaypointFormState(waypoint));
  // Latest form snapshot, so commit() never has to read state inside a setState updater
  // (which would fire the parent's onUpdate during render).
  const formRef = useRef(form);
  formRef.current = form;
  const [activeLang, setActiveLang] = useState<Language>(lang);
  const [maritimeMode, setMaritimeMode] = useState<MaritimeMode>("auto");
  const [aiBusy, setAiBusy] = useState(false);
  const [maritimeBusy, setMaritimeBusy] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Reload the form whenever a different waypoint is opened.
  useEffect(() => {
    setForm(buildWaypointFormState(waypoint));
    setActiveLang(lang);
    setMaritimeMode("auto");
    // waypoint identity is what matters; field edits come back through onUpdate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waypoint.id]);

  const defaultNames = useMemo(
    () => buildWaypointDefaultLocalizedNames(index, waypoint.lat, waypoint.lng),
    [index, waypoint.lat, waypoint.lng]
  );
  const effectiveType = getWaypointEffectiveType(waypoint, index, total);
  const isWaterVoyage = voyageType === "water";

  const heading = getWaypointSequenceHeading(index, total, lang);
  const coords = formatWaypointCoordinateLabel(waypoint.lat, waypoint.lng);

  const statusLabel =
    waypoint.visibility_mode === "manual"
      ? effectiveType === "narrative"
        ? "Visible"
        : "Hidden"
      : effectiveType === "narrative"
        ? index === 0
          ? "Auto start"
          : "Auto end"
        : "Auto hidden";

  // Which detail block to show follows the CURRENT visibility choice, live.
  const detailsType: "narrative" | "technical" =
    form.visibility === "narrative"
      ? "narrative"
      : form.visibility === "technical"
        ? "technical"
        : index === 0 || index === total - 1
          ? "narrative"
          : "technical";

  const commit = useCallback(
    (state: WaypointFormState, options?: WaypointUpdateOptions) => {
      const changes = computeWaypointFormChanges(state, {
        defaultNames,
        currentNameIt: waypoint.name_it,
        currentNameEn: waypoint.name_en,
        datesTbd,
        lang,
        index,
        lat: waypoint.lat,
        lng: waypoint.lng,
      });
      void onUpdate(changes, options);
    },
    [datesTbd, defaultNames, index, lang, onUpdate, waypoint.lat, waypoint.lng, waypoint.name_en, waypoint.name_it]
  );

  // Update local state; text fields persist on blur, controls persist immediately.
  const patch = useCallback((changes: Partial<WaypointFormState>) => {
    setForm((prev) => ({ ...prev, ...changes }));
  }, []);

  const patchAndCommit = useCallback(
    (changes: Partial<WaypointFormState>) => {
      const next = { ...formRef.current, ...changes };
      setForm(next);
      commit(next);
    },
    [commit]
  );

  const handleAiTranslate = useCallback(async () => {
    setAiBusy(true);
    try {
      const result = await invokeTranslateEditorContent({
        kind: "waypoint",
        name_it: form.nameIt,
        name_en: form.nameEn,
        description_it: form.descriptionIt,
        description_en: form.descriptionEn,
      });
      if (result.ok === false) {
        toast.error(result.error);
        return;
      }
      if (result.skipped) {
        toast.message("Niente da tradurre: compila i campi in una lingua e lascia vuoti quelli nell'altra.");
        return;
      }
      const f = result.fields as Record<string, unknown>;
      const next: Partial<WaypointFormState> = {};
      if (typeof f.name_it === "string") next.nameIt = f.name_it;
      if (typeof f.name_en === "string") next.nameEn = f.name_en;
      if (typeof f.description_it === "string") next.descriptionIt = f.description_it;
      if (typeof f.description_en === "string") next.descriptionEn = f.description_en;
      patchAndCommit(next);
      toast.success("Traduzione applicata.");
    } finally {
      setAiBusy(false);
    }
  }, [form.descriptionEn, form.descriptionIt, form.nameEn, form.nameIt, patchAndCommit]);

  const handleApplyMaritimeName = useCallback(async () => {
    setMaritimeBusy(true);
    try {
      const place = await reverseGeocodePlaceLocalized(waypoint.lat, waypoint.lng, {
        maritime: true,
        maritimeLabelMode: maritimeMode,
      });
      if (!place.it && !place.en) {
        toast.error("Nessun nome coerente trovato per questo punto.");
        return;
      }
      patchAndCommit({
        nameIt: place.it || place.en || form.nameIt,
        nameEn: place.en || place.it || form.nameEn,
      });
      toast.success("Nome waypoint aggiornato.");
    } finally {
      setMaritimeBusy(false);
    }
  }, [form.nameEn, form.nameIt, maritimeMode, patchAndCommit, waypoint.lat, waypoint.lng]);

  const handleUploadMedia = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setMediaBusy(true);
      try {
        const uploaded = await onUploadMedia(files);
        if (fileInputRef.current) fileInputRef.current.value = "";
        if (!uploaded.length) return;
        await onUpdate(
          { media: [...waypoint.media, ...uploaded] },
          { successMessage: uploaded.length === 1 ? "Media added" : `${uploaded.length} media added` }
        );
      } finally {
        setMediaBusy(false);
      }
    },
    [onUpdate, onUploadMedia, waypoint.media]
  );

  const handleDeleteMedia = useCallback(
    async (item: VoyageWaypointMediaItem) => {
      await onDeleteMedia(item);
      await onUpdate(
        { media: waypoint.media.filter((entry) => entry !== item) },
        { successMessage: "Media removed" }
      );
    },
    [onDeleteMedia, onUpdate, waypoint.media]
  );

  return (
    <form
      className="grid gap-3 p-0.5 font-sans"
      onSubmit={(event) => {
        event.preventDefault();
        commit(form, { successMessage: "Waypoint updated" });
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="m-0 mb-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{heading}</p>
          <p className="m-0 text-xs text-muted-foreground">{coords}</p>
        </div>
        <span
          className={`text-[11px] px-1.5 py-1 ${
            effectiveType === "technical"
              ? "bg-muted-foreground/10 text-muted-foreground"
              : "bg-teal-500/10 text-teal-700 dark:text-teal-300"
          }`}
        >
          {statusLabel}
        </span>
      </div>

      <section className={sectionClass}>
        <p className={sectionTitleClass}>Testi</p>
        <button
          type="button"
          onClick={() => void handleAiTranslate()}
          disabled={aiBusy}
          className="justify-self-start inline-flex items-center gap-2 px-2.5 py-1.5 border border-border bg-muted text-foreground text-[11px] font-semibold cursor-pointer rounded-sm hover:bg-muted/70 transition-colors disabled:opacity-60"
        >
          {aiBusy ? <Loader2 size={12} className="animate-spin" /> : null}
          Traduci campi vuoti (IT↔EN)
        </button>
        <div className="flex gap-1.5" role="tablist" aria-label="Lingua contenuti waypoint">
          {(["it", "en"] as const).map((code) => {
            const active = activeLang === code;
            return (
              <button
                key={code}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveLang(code)}
                className={`px-3 py-1 text-[11px] font-semibold rounded-full border transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground border-transparent"
                    : "bg-muted text-foreground border-transparent hover:bg-muted/70"
                }`}
              >
                {code === "it" ? "Italiano" : "English"}
              </button>
            );
          })}
        </div>
        {activeLang === "it" ? (
          <div className="grid gap-2.5">
            <div>
              <label className={labelClass}>Nome</label>
              <input
                type="text"
                value={form.nameIt}
                placeholder={defaultNames.it}
                onChange={(event) => patch({ nameIt: event.target.value })}
                onBlur={() => commit(form)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Descrizione</label>
              <textarea
                rows={4}
                value={form.descriptionIt}
                onChange={(event) => patch({ descriptionIt: event.target.value })}
                onBlur={() => commit(form)}
                className={`${inputClass} min-h-[68px] resize-y`}
              />
            </div>
          </div>
        ) : (
          <div className="grid gap-2.5">
            <div>
              <label className={labelClass}>Name</label>
              <input
                type="text"
                value={form.nameEn}
                placeholder={defaultNames.en}
                onChange={(event) => patch({ nameEn: event.target.value })}
                onBlur={() => commit(form)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Description</label>
              <textarea
                rows={4}
                value={form.descriptionEn}
                onChange={(event) => patch({ descriptionEn: event.target.value })}
                onBlur={() => commit(form)}
                className={`${inputClass} min-h-[68px] resize-y`}
              />
            </div>
          </div>
        )}
      </section>

      <section className={sectionClass}>
        <p className={sectionTitleClass}>Details</p>
        <div>
          <label className={labelClass}>Visibility</label>
          <div className={`${segmentGroupClass} grid-cols-1 sm:grid-cols-3`} role="group" aria-label="Visibility waypoint">
            {visibilityChoices.map((choice) => {
              const active = form.visibility === choice.value;
              return (
                <button
                  key={choice.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => patchAndCommit({ visibility: choice.value })}
                  className={`${segmentButtonClass} ${active ? activeSegmentButtonClass : ""}`}
                >
                  {choice.label}
                </button>
              );
            })}
          </div>
        </div>

        {isWaterVoyage ? (
          <div className="grid gap-2">
            <label className={labelClass}>Naming</label>
            <div className="grid grid-cols-1 gap-2">
              <div className={`${segmentGroupClass} grid-cols-3`} role="group" aria-label="Naming waypoint">
                {maritimeChoices.map((choice) => {
                  const active = maritimeMode === choice.value;
                  return (
                    <button
                      key={choice.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setMaritimeMode(choice.value)}
                      className={`${segmentButtonClass} text-center ${active ? activeSegmentButtonClass : ""}`}
                    >
                      {choice.label}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => void handleApplyMaritimeName()}
                disabled={maritimeBusy}
                className="inline-flex items-center gap-2 px-2.5 py-2 border border-border bg-muted text-foreground text-[11px] font-semibold cursor-pointer whitespace-nowrap hover:bg-muted/70 transition-colors disabled:opacity-60"
              >
                {maritimeBusy ? <Loader2 size={12} className="animate-spin" /> : null}
                Applica
              </button>
            </div>
            <p className="m-0 text-[11px] leading-relaxed text-muted-foreground">
              Città usa il centro costiero vicino; Baia/cala forza il toponimo marittimo più vicino.
            </p>
          </div>
        ) : null}

        {datesTbd ? (
          <div className="grid gap-2">
            <p className="m-0 text-[11px] leading-relaxed text-muted-foreground">
              Viaggio planned con date disattivate: nessuna data viene salvata sui waypoint.
            </p>
            <p className="m-0 text-[11px] leading-relaxed text-muted-foreground">
              {legEstimateLabel ?? "Primo waypoint: nessun tempo di percorrenza precedente da stimare."}
            </p>
          </div>
        ) : detailsType === "narrative" ? (
          <div className="grid gap-2.5">
            <div>
              <label className={labelClass}>Arrival</label>
              <input
                type="datetime-local"
                value={form.arrivalLocal}
                placeholder={arrivalPlaceholder}
                onChange={(event) => patch({ arrivalLocal: event.target.value })}
                onBlur={() => commit(form)}
                className={inputClass}
              />
              {arrivalNote ? <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{arrivalNote}</p> : null}
            </div>
            <div>
              <label className={labelClass}>Departure</label>
              <input
                type="datetime-local"
                value={form.departureLocal}
                placeholder={departurePlaceholder}
                onChange={(event) => patch({ departureLocal: event.target.value })}
                onBlur={() => commit(form)}
                className={inputClass}
              />
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                {departureNote || "Opzionale. Se valorizzata, verrà usata per stimare le tappe successive."}
              </p>
            </div>
            <div>
              <label className={labelClass}>Sosta e ripartenza</label>
              <div className={`${segmentGroupClass} grid-cols-1 sm:grid-cols-3`} role="group" aria-label="Sosta waypoint">
                {stopModeChoices.map((choice) => {
                  const active = form.stopMode === choice.value;
                  return (
                    <button
                      key={choice.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => patchAndCommit({ stopMode: choice.value })}
                      className={`${segmentButtonClass} ${active ? activeSegmentButtonClass : ""}`}
                    >
                      {choice.label}
                    </button>
                  );
                })}
              </div>

              {form.stopMode === "hours" ? (
                <div className="grid gap-1.5 mt-2">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={form.stopHours}
                    onChange={(event) => patch({ stopHours: event.target.value })}
                    onBlur={() => commit(form)}
                    className={inputClass}
                  />
                  <div className="flex gap-1.5 flex-wrap">
                    {["8", "12"].map((value) => (
                      <button key={value} type="button" className={chipClass} onClick={() => patchAndCommit({ stopHours: value })}>
                        {value}h
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {form.stopMode === "nights" ? (
                <div className="grid gap-1.5 mt-2">
                  <label className={labelClass}>Giorni di sosta</label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={form.stopNights}
                    onChange={(event) => patch({ stopNights: event.target.value })}
                    onBlur={() => commit(form)}
                    className={inputClass}
                  />
                  <div className="flex gap-1.5 flex-wrap">
                    {["1", "2", "3"].map((value) => (
                      <button key={value} type="button" className={chipClass} onClick={() => patchAndCommit({ stopNights: value })}>
                        {value}
                      </button>
                    ))}
                  </div>
                  <label className={labelClass}>Orario di ripartenza</label>
                  <input
                    type="time"
                    value={form.stopDeparture}
                    onChange={(event) => patch({ stopDeparture: event.target.value })}
                    onBlur={() => commit(form)}
                    className={inputClass}
                  />
                  <div className="flex gap-1.5 flex-wrap">
                    {STOP_DEPARTURE_PRESETS.map((value) => (
                      <button key={value} type="button" className={chipClass} onClick={() => patchAndCommit({ stopDeparture: value })}>
                        {value}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                Es.: arrivo il 10 alle 15 con 2 giorni e ripartenza 19:00 → si riparte il 12 alle 19:00.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)_112px] gap-2.5">
            <div>
              <label className={labelClass}>Passage date</label>
              <input
                type="date"
                value={form.eventDate}
                onChange={(event) => patch({ eventDate: event.target.value })}
                onBlur={() => commit(form)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Time</label>
              <input
                type="time"
                value={form.eventTime}
                onChange={(event) => patch({ eventTime: event.target.value })}
                onBlur={() => commit(form)}
                className={inputClass}
              />
            </div>
            <p className="col-span-2 m-0 text-[11px] leading-relaxed text-muted-foreground">
              Opzionale. Se inserita manualmente, verrà usata per stimare i waypoint successivi.
            </p>
          </div>
        )}
      </section>

      <section className={sectionClass}>
        <p className={sectionTitleClass}>Media</p>
        <div className="grid gap-2.5">
          {waypoint.media.length === 0 ? (
            <p className="m-0 text-[11px] text-muted-foreground">No media attached yet.</p>
          ) : (
            waypoint.media.map((item, mediaIndex) => (
              <div key={`${item.url}-${mediaIndex}`} className="grid gap-1.5">
                {item.kind === "image" ? (
                  <img src={item.url} alt="" className="w-full h-[84px] object-cover border border-border" />
                ) : item.kind === "video" ? (
                  <video src={item.url} muted playsInline className="w-full h-[84px] object-cover border border-border" />
                ) : (
                  <div className="flex items-center justify-center h-[84px] border border-border bg-muted text-[11px] text-muted-foreground">
                    File
                  </div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-foreground no-underline whitespace-nowrap overflow-hidden text-ellipsis max-w-[180px]"
                  >
                    {item.name || `Asset ${mediaIndex + 1}`}
                  </a>
                  <button
                    type="button"
                    onClick={() => void handleDeleteMedia(item)}
                    className="px-1.5 py-1 border border-border bg-background text-[10px] cursor-pointer hover:bg-muted transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          disabled={mediaBusy}
          onChange={(event) => void handleUploadMedia(Array.from(event.target.files ?? []))}
          className={`${inputClass} py-1.5`}
        />
      </section>

      <div className="sticky -bottom-1.5 flex gap-2 flex-wrap pt-1 bg-gradient-to-t from-background from-70% to-transparent">
        <button
          type="button"
          onClick={onRelocate}
          className="basis-full inline-flex items-center justify-center gap-2 px-2.5 py-2 border border-border bg-background text-foreground text-xs font-semibold cursor-pointer hover:bg-muted transition-colors"
        >
          <MapPin size={13} /> Move on map
        </button>
        <button
          type="submit"
          className="flex-1 px-2.5 py-2 border-none bg-primary text-primary-foreground text-xs font-semibold cursor-pointer hover:opacity-90 transition-opacity"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex items-center gap-1.5 px-2.5 py-2 border border-border bg-background text-foreground text-xs font-semibold cursor-pointer hover:bg-muted transition-colors"
        >
          <Trash2 size={13} /> Delete
        </button>
      </div>
    </form>
  );
};

export default WaypointEditorPanel;
