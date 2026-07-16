import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  Eye,
  EyeOff,
  Languages,
  Loader2,
  MapPin,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import PhotoPointLocationPicker from "@/components/admin/PhotoPointLocationPicker";
import { supabase } from "@/integrations/supabase/client";
import {
  LOGBOOK_PHOTO_BUCKET,
  buildPhotoObjectPath,
  buildPhotoPointUrl,
  resolveVoyageForPhoto,
  type LogbookPhotoPoint,
} from "@/lib/logbook-photo-points";
import { fallbackTakenAt, readPhotoMetadata } from "@/lib/photo-exif";
import { isAuthFailureError } from "@/lib/supabase-auth";
import { invokeTranslateEditorContent } from "@/lib/translate-editor-content";

type VoyageOption = {
  id: string;
  name: string;
  name_it: string | null;
  name_en: string | null;
  start_date: string | null;
  end_date: string | null;
};

/** A photo picked but not yet saved: EXIF already read, text still to write. */
type PhotoDraft = {
  file: File;
  previewUrl: string;
  lat: number | null;
  lng: number | null;
  coordinatesSource: "exif" | "manual";
  takenAt: Date | null;
  takenAtSource: "gps" | "exif-offset" | "exif-local" | "file" | null;
  width: number | null;
  height: number | null;
  voyageId: string | null;
  voyageIsManual: boolean;
  titleIt: string;
  titleEn: string;
  descriptionIt: string;
  descriptionEn: string;
  isPublished: boolean;
};

const NO_VOYAGE = "__none__";

const TAKEN_AT_SOURCE_LABEL: Record<NonNullable<PhotoDraft["takenAtSource"]>, string> = {
  gps: "dal timestamp GPS della foto",
  "exif-offset": "dall'EXIF, con fuso orario della fotocamera",
  "exif-local": "dall'EXIF, letto come ora italiana",
  file: "dalla data del file: l'EXIF non aveva una data",
};

/** `datetime-local` wants wall-clock in the browser zone, with no trailing Z. */
const toDateTimeLocalValue = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
};

const voyageLabel = (voyage: VoyageOption): string => {
  const name = voyage.name_it?.trim() || voyage.name_en?.trim() || voyage.name;
  const window = [voyage.start_date, voyage.end_date].filter(Boolean).join(" → ");
  return window ? `${name} (${window})` : name;
};

const AdminLogbookPoints = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [points, setPoints] = useState<LogbookPhotoPoint[]>([]);
  const [voyages, setVoyages] = useState<VoyageOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<PhotoDraft[]>([]);
  const [draft, setDraft] = useState<PhotoDraft | null>(null);
  const [isReadingExif, setIsReadingExif] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);

  const handleAuthFailure = useCallback(
    async (error: unknown) => {
      if (isAuthFailureError(error)) {
        await supabase.auth.signOut();
        navigate("/login", { state: { from: "/admin/logbook-points" } });
        return true;
      }
      return false;
    },
    [navigate]
  );

  const fetchPoints = useCallback(async () => {
    setLoading(true);
    try {
      const [pointsResult, voyagesResult] = await Promise.all([
        supabase
          .from("logbook_photo_points" as never)
          .select("*")
          .order("taken_at", { ascending: false }),
        supabase
          .from("voyages" as never)
          .select("id,name,name_it,name_en,start_date,end_date")
          .order("sort_order", { ascending: true }),
      ]);

      if (pointsResult.error) throw pointsResult.error;
      if (voyagesResult.error) throw voyagesResult.error;

      setPoints((pointsResult.data ?? []) as unknown as LogbookPhotoPoint[]);
      setVoyages((voyagesResult.data ?? []) as unknown as VoyageOption[]);
    } catch (error) {
      if (await handleAuthFailure(error)) return;
      console.error("Failed to load logbook photo points", error);
      toast.error("Impossibile leggere i punti foto");
    } finally {
      setLoading(false);
    }
  }, [handleAuthFailure]);

  useEffect(() => {
    void fetchPoints();
  }, [fetchPoints]);

  // Object URLs for drafts still waiting in the queue would leak on unmount otherwise.
  useEffect(
    () => () => {
      queue.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    },
    [queue]
  );

  const voyagesById = useMemo(
    () => new Map(voyages.map((voyage) => [voyage.id, voyage])),
    [voyages]
  );

  /** Reads the file's metadata and turns it into a draft, resolving the voyage from the date. */
  const buildDraft = useCallback(async (file: File): Promise<PhotoDraft> => {
    const metadata = await readPhotoMetadata(file);
    const takenAt = metadata.takenAt ?? fallbackTakenAt(file);
    const takenAtSource = metadata.takenAt ? metadata.takenAtSource : takenAt ? "file" : null;
    const voyageId = takenAt ? await resolveVoyageForPhoto(takenAt) : null;

    return {
      file,
      previewUrl: URL.createObjectURL(file),
      lat: metadata.coordinates?.lat ?? null,
      lng: metadata.coordinates?.lng ?? null,
      coordinatesSource: metadata.coordinates ? "exif" : "manual",
      takenAt,
      takenAtSource,
      width: metadata.width,
      height: metadata.height,
      voyageId,
      voyageIsManual: false,
      titleIt: "",
      titleEn: "",
      descriptionIt: "",
      descriptionEn: "",
      isPublished: false,
    };
  }, []);

  const handleFilesSelected = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;

    setIsReadingExif(true);
    try {
      const drafts = await Promise.all(files.map(buildDraft));
      const [first, ...rest] = drafts;
      setDraft(first);
      setQueue(rest);

      const withoutGps = drafts.filter((item) => item.lat == null).length;
      if (withoutGps > 0) {
        toast.info(
          withoutGps === drafts.length
            ? "Nessun GPS nell'EXIF: posiziona il punto sulla mappa."
            : `${withoutGps} foto su ${drafts.length} senza GPS: andranno posizionate a mano.`
        );
      }
    } finally {
      setIsReadingExif(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const updateDraft = (patch: Partial<PhotoDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  /** Re-resolves the voyage when the date moves, unless the editor took the wheel. */
  const handleTakenAtChange = async (value: string) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return;
    updateDraft({ takenAt: parsed });

    if (draft?.voyageIsManual) return;
    const voyageId = await resolveVoyageForPhoto(parsed);
    setDraft((current) =>
      current && !current.voyageIsManual ? { ...current, voyageId } : current
    );
  };

  const handleTranslate = async () => {
    if (!draft) return;
    setIsTranslating(true);
    try {
      // The waypoint kind already carries exactly these four fields, so a photo point
      // reuses it rather than teaching the function a new shape.
      const result = await invokeTranslateEditorContent({
        kind: "waypoint",
        name_it: draft.titleIt,
        name_en: draft.titleEn,
        description_it: draft.descriptionIt,
        description_en: draft.descriptionEn,
      });

      if (result.ok === false) {
        toast.error(result.error);
        return;
      }
      if (result.skipped === "nothing_to_translate") {
        toast.info("Niente da tradurre: compila almeno un lato.");
        return;
      }

      const fields = result.fields as Record<string, string | undefined>;
      updateDraft({
        titleIt: fields.name_it ?? draft.titleIt,
        titleEn: fields.name_en ?? draft.titleEn,
        descriptionIt: fields.description_it ?? draft.descriptionIt,
        descriptionEn: fields.description_en ?? draft.descriptionEn,
      });
      toast.success("Traduzione completata");
    } finally {
      setIsTranslating(false);
    }
  };

  const advanceQueue = () => {
    setQueue((current) => {
      const [next, ...rest] = current;
      setDraft(next ?? null);
      return rest;
    });
  };

  const discardDraft = () => {
    if (draft) URL.revokeObjectURL(draft.previewUrl);
    advanceQueue();
  };

  const saveDraft = async () => {
    if (!draft) return;

    if (draft.lat == null || draft.lng == null) {
      toast.error("Posiziona il punto sulla mappa prima di salvare.");
      return;
    }
    if (!draft.takenAt) {
      toast.error("Serve una data di scatto.");
      return;
    }
    if (!draft.titleIt.trim() || !draft.titleEn.trim()) {
      toast.error("Il nome serve in entrambe le lingue.");
      return;
    }

    setIsSaving(true);
    const objectPath = buildPhotoObjectPath(draft.file);

    try {
      const { error: uploadError } = await supabase.storage
        .from(LOGBOOK_PHOTO_BUCKET)
        .upload(objectPath, draft.file, {
          cacheControl: "31536000",
          contentType: draft.file.type,
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from("logbook_photo_points" as never).insert({
        voyage_id: draft.voyageId,
        voyage_is_manual: draft.voyageIsManual,
        taken_at: draft.takenAt.toISOString(),
        lat: draft.lat,
        lng: draft.lng,
        coordinates_source: draft.coordinatesSource,
        title_it: draft.titleIt.trim(),
        title_en: draft.titleEn.trim(),
        description_it: draft.descriptionIt.trim() || null,
        description_en: draft.descriptionEn.trim() || null,
        storage_path: objectPath,
        width: draft.width,
        height: draft.height,
        is_published: draft.isPublished,
      } as never);

      if (insertError) {
        // Leaving the object behind would block a retry on the unique storage_path.
        await supabase.storage.from(LOGBOOK_PHOTO_BUCKET).remove([objectPath]);
        throw insertError;
      }

      toast.success(
        draft.isPublished ? "Punto creato e pubblicato" : "Punto creato come bozza"
      );
      URL.revokeObjectURL(draft.previewUrl);
      advanceQueue();
      await fetchPoints();
    } catch (error) {
      if (await handleAuthFailure(error)) return;
      console.error("Failed to save the photo point", error);
      toast.error("Salvataggio non riuscito");
    } finally {
      setIsSaving(false);
    }
  };

  const togglePublished = async (point: LogbookPhotoPoint) => {
    const next = !point.is_published;
    setPoints((current) =>
      current.map((item) => (item.id === point.id ? { ...item, is_published: next } : item))
    );
    const { error } = await supabase
      .from("logbook_photo_points" as never)
      .update({ is_published: next } as never)
      .eq("id", point.id);
    if (error) {
      if (await handleAuthFailure(error)) return;
      toast.error("Impossibile cambiare lo stato");
      await fetchPoints();
      return;
    }
    toast.success(next ? "Punto pubblicato" : "Punto nascosto");
  };

  const deletePoint = async (point: LogbookPhotoPoint) => {
    if (!window.confirm(`Eliminare "${point.title_it}"? La foto viene rimossa dal bucket.`)) return;

    const { error } = await supabase
      .from("logbook_photo_points" as never)
      .delete()
      .eq("id", point.id);
    if (error) {
      if (await handleAuthFailure(error)) return;
      toast.error("Eliminazione non riuscita");
      return;
    }
    await supabase.storage.from(LOGBOOK_PHOTO_BUCKET).remove([point.storage_path]);
    toast.success("Punto eliminato");
    await fetchPoints();
  };

  const resolvedVoyageName = draft?.voyageId
    ? voyagesById.get(draft.voyageId)?.name_it?.trim() ||
      voyagesById.get(draft.voyageId)?.name ||
      null
    : null;

  return (
    <div className="min-h-screen bg-background px-4 py-8 md:px-8">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="space-y-4">
          <Button variant="ghost" size="sm" asChild className="-ml-2">
            <Link to="/admin">
              <ArrowLeft size={16} className="mr-1.5" />
              Admin
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Punti foto del logbook</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Carica una foto: coordinate, data e viaggio vengono letti dai metadati. Tu scrivi
              solo nome e descrizione.
            </p>
          </div>
        </header>

        <section className="rounded-2xl border border-border bg-card p-6">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif"
            multiple
            className="hidden"
            onChange={(event) => void handleFilesSelected(event.target.files)}
          />
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">Carica foto</p>
              <p className="text-sm text-muted-foreground">
                JPEG, PNG, WebP, HEIC. Puoi selezionarne più di una: te le chiedo in fila.
              </p>
            </div>
            <Button onClick={() => fileInputRef.current?.click()} disabled={isReadingExif}>
              {isReadingExif ? (
                <Loader2 size={16} className="mr-2 animate-spin" />
              ) : (
                <UploadCloud size={16} className="mr-2" />
              )}
              {isReadingExif ? "Leggo i metadati…" : "Scegli le foto"}
            </Button>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-medium">Punti esistenti</h2>
            <span className="text-sm text-muted-foreground">
              {points.length} {points.length === 1 ? "punto" : "punti"}
            </span>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 rounded-xl border border-border p-6 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin" />
              Carico…
            </div>
          ) : points.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Nessun punto foto. Carica la prima foto qui sopra.
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {points.map((point) => {
                const voyage = point.voyage_id ? voyagesById.get(point.voyage_id) : null;
                return (
                  <li
                    key={point.id}
                    className="flex gap-3 rounded-xl border border-border bg-card p-3"
                  >
                    <img
                      src={buildPhotoPointUrl(point.storage_path)}
                      alt={point.title_it}
                      loading="lazy"
                      className="h-20 w-20 shrink-0 rounded-lg object-cover"
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate font-medium">{point.title_it}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(point.taken_at).toLocaleString("it-IT")}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {voyage
                          ? voyage.name_it?.trim() || voyage.name
                          : "Nessun viaggio attribuito"}
                        {point.voyage_is_manual ? " · override" : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {point.lat.toFixed(4)}, {point.lng.toFixed(4)}
                        {point.coordinates_source === "manual" ? " · a mano" : " · EXIF"}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title={point.is_published ? "Nascondi" : "Pubblica"}
                        onClick={() => void togglePublished(point)}
                      >
                        {point.is_published ? <Eye size={16} /> : <EyeOff size={16} />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Elimina"
                        onClick={() => void deletePoint(point)}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <Dialog open={Boolean(draft)} onOpenChange={(open) => !open && discardDraft()}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera size={18} />
              Nuovo punto foto
            </DialogTitle>
            <DialogDescription>
              {queue.length > 0
                ? `Dopo questa ne restano altre ${queue.length}.`
                : "Ultima foto della selezione."}
            </DialogDescription>
          </DialogHeader>

          {draft ? (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <img
                  src={draft.previewUrl}
                  alt=""
                  className="h-48 w-full rounded-xl object-cover"
                />
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="photo-taken-at">Data di scatto</Label>
                    <Input
                      id="photo-taken-at"
                      type="datetime-local"
                      value={draft.takenAt ? toDateTimeLocalValue(draft.takenAt) : ""}
                      onChange={(event) => void handleTakenAtChange(event.target.value)}
                    />
                    {draft.takenAtSource ? (
                      <p className="text-xs text-muted-foreground">
                        Letta {TAKEN_AT_SOURCE_LABEL[draft.takenAtSource]}.
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="photo-voyage">Viaggio</Label>
                    <Select
                      value={draft.voyageId ?? NO_VOYAGE}
                      onValueChange={(value) =>
                        updateDraft({
                          voyageId: value === NO_VOYAGE ? null : value,
                          voyageIsManual: true,
                        })
                      }
                    >
                      <SelectTrigger id="photo-voyage">
                        <SelectValue placeholder="Nessun viaggio" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_VOYAGE}>Nessun viaggio</SelectItem>
                        {voyages.map((voyage) => (
                          <SelectItem key={voyage.id} value={voyage.id}>
                            {voyageLabel(voyage)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {draft.voyageIsManual
                        ? "Scelto a mano: la data non lo cambierà più."
                        : resolvedVoyageName
                          ? `Attribuito automaticamente a ${resolvedVoyageName} dalla data.`
                          : "Nessun viaggio copre questa data. Puoi sceglierlo a mano."}
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <MapPin size={14} />
                  Posizione
                </Label>
                <PhotoPointLocationPicker
                  lat={draft.lat}
                  lng={draft.lng}
                  isFromExif={draft.coordinatesSource === "exif"}
                  onChange={(lat, lng) =>
                    updateDraft({
                      lat,
                      lng,
                      // Touching the pin means the fix is no longer the camera's.
                      coordinatesSource: "manual",
                    })
                  }
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Nome e descrizione</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleTranslate()}
                    disabled={isTranslating}
                  >
                    {isTranslating ? (
                      <Loader2 size={14} className="mr-1.5 animate-spin" />
                    ) : (
                      <Languages size={14} className="mr-1.5" />
                    )}
                    Traduci il lato mancante
                  </Button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="photo-title-it" className="text-xs text-muted-foreground">
                      Nome (IT)
                    </Label>
                    <Input
                      id="photo-title-it"
                      value={draft.titleIt}
                      onChange={(event) => updateDraft({ titleIt: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="photo-title-en" className="text-xs text-muted-foreground">
                      Nome (EN)
                    </Label>
                    <Input
                      id="photo-title-en"
                      value={draft.titleEn}
                      onChange={(event) => updateDraft({ titleEn: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="photo-desc-it" className="text-xs text-muted-foreground">
                      Descrizione (IT)
                    </Label>
                    <Textarea
                      id="photo-desc-it"
                      rows={4}
                      value={draft.descriptionIt}
                      onChange={(event) => updateDraft({ descriptionIt: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="photo-desc-en" className="text-xs text-muted-foreground">
                      Descrizione (EN)
                    </Label>
                    <Textarea
                      id="photo-desc-en"
                      rows={4}
                      value={draft.descriptionEn}
                      onChange={(event) => updateDraft({ descriptionEn: event.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 rounded-xl border border-border p-3">
                <Switch
                  id="photo-published"
                  checked={draft.isPublished}
                  onCheckedChange={(checked) => updateDraft({ isPublished: checked })}
                />
                <Label htmlFor="photo-published" className="cursor-pointer font-normal">
                  Pubblica subito sulla mappa del logbook
                </Label>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" onClick={discardDraft} disabled={isSaving}>
              Scarta
            </Button>
            <Button onClick={() => void saveDraft()} disabled={isSaving}>
              {isSaving ? <Loader2 size={16} className="mr-2 animate-spin" /> : null}
              Salva punto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminLogbookPoints;
