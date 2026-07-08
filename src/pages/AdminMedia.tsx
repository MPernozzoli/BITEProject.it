import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Copy, ExternalLink, FileVideo, Image, Loader2, RefreshCw, Trash2, UploadCloud } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { isAuthFailureError } from "@/lib/supabase-auth";

type MediaPresetId = "hero-horizontal" | "hero-vertical" | "logbook";

type MediaPreset = {
  id: MediaPresetId;
  label: string;
  bucket: "homepage-media" | "logbook-media";
  folder: string;
  accept: string;
  hint: string;
};

type StorageFile = {
  id?: string;
  name: string;
  updated_at?: string | null;
  created_at?: string | null;
  last_accessed_at?: string | null;
  metadata?: {
    size?: number;
    mimetype?: string;
  } | null;
};

const MEDIA_PRESETS: MediaPreset[] = [
  {
    id: "hero-horizontal",
    label: "Home hero desktop",
    bucket: "homepage-media",
    folder: "hero-horizontal",
    accept: "video/mp4,video/webm,video/quicktime,video/x-m4v,image/jpeg,image/png,image/webp,image/avif",
    hint: "Video orizzontali e poster per desktop.",
  },
  {
    id: "hero-vertical",
    label: "Home hero mobile",
    bucket: "homepage-media",
    folder: "hero-vertical",
    accept: "video/mp4,video/webm,video/quicktime,video/x-m4v,image/jpeg,image/png,image/webp,image/avif",
    hint: "Video verticali e poster per mobile.",
  },
  {
    id: "logbook",
    label: "Logbook media",
    bucket: "logbook-media",
    folder: "admin-uploads",
    accept: "image/*,video/*",
    hint: "Media pubblici riutilizzabili in articoli, newsletter, profili e waypoint.",
  },
];

const pathSafePart = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

const formatBytes = (bytes?: number) => {
  if (!bytes || !Number.isFinite(bytes)) return "n.d.";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
};

const getKindIcon = (file: StorageFile) => {
  const mimetype = file.metadata?.mimetype ?? "";
  if (mimetype.startsWith("video/") || /\.(mp4|webm|m4v|mov)$/i.test(file.name)) {
    return <FileVideo size={16} />;
  }
  return <Image size={16} />;
};

const AdminMedia = () => {
  const navigate = useNavigate();
  const [presetId, setPresetId] = useState<MediaPresetId>("hero-horizontal");
  const [customFolder, setCustomFolder] = useState("");
  const [files, setFiles] = useState<StorageFile[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [ensuringBuckets, setEnsuringBuckets] = useState(false);
  const [lastUploadedUrls, setLastUploadedUrls] = useState<string[]>([]);

  const preset = useMemo(
    () => MEDIA_PRESETS.find((item) => item.id === presetId) ?? MEDIA_PRESETS[0],
    [presetId]
  );

  const folder = useMemo(() => {
    const normalized = customFolder
      .split("/")
      .map((part) => pathSafePart(part))
      .filter(Boolean)
      .join("/");
    return normalized || preset.folder;
  }, [customFolder, preset.folder]);

  const buildPublicUrl = useCallback(
    (path: string) => supabase.storage.from(preset.bucket).getPublicUrl(path).data.publicUrl,
    [preset.bucket]
  );

  const handleAuthFailure = useCallback(async (error: unknown) => {
    if (isAuthFailureError(error)) {
      await supabase.auth.signOut();
      navigate("/login", { state: { from: "/admin/media" } });
      return true;
    }
    return false;
  }, [navigate]);

  const ensureBuckets = useCallback(async () => {
    setEnsuringBuckets(true);
    try {
      const { error } = await supabase.functions.invoke("admin-storage-buckets", { body: {} });
      if (error) throw error;
      toast.success("Bucket media verificati");
    } catch (error) {
      if (await handleAuthFailure(error)) return;
      console.error("Failed to ensure storage buckets", error);
      toast.error("Impossibile verificare i bucket media");
    } finally {
      setEnsuringBuckets(false);
    }
  }, [handleAuthFailure]);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.storage.from(preset.bucket).list(folder, {
        limit: 100,
        sortBy: { column: "updated_at", order: "desc" },
      });
      if (error) throw error;
      setFiles((data ?? []) as StorageFile[]);
    } catch (error) {
      if (await handleAuthFailure(error)) return;
      console.error("Failed to load media files", error);
      toast.error("Impossibile leggere i media");
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [folder, handleAuthFailure, preset.bucket]);

  useEffect(() => {
    void fetchFiles();
  }, [fetchFiles]);

  const uploadFiles = async () => {
    if (!selectedFiles?.length) {
      toast.error("Seleziona almeno un file");
      return;
    }

    setUploading(true);
    setLastUploadedUrls([]);

    try {
      const uploadedUrls: string[] = [];
      for (const file of Array.from(selectedFiles)) {
        const safeName = pathSafePart(file.name) || `media-${Date.now()}`;
        const objectPath = `${folder}/${Date.now()}-${safeName}`;
        const { error } = await supabase.storage.from(preset.bucket).upload(objectPath, file, {
          cacheControl: "31536000",
          upsert: false,
          contentType: file.type || undefined,
        });
        if (error) throw error;
        uploadedUrls.push(buildPublicUrl(objectPath));
      }

      setLastUploadedUrls(uploadedUrls);
      setSelectedFiles(null);
      toast.success(uploadedUrls.length === 1 ? "Media caricato" : `${uploadedUrls.length} media caricati`);
      await fetchFiles();
    } catch (error) {
      if (await handleAuthFailure(error)) return;
      console.error("Failed to upload media", error);
      toast.error("Upload non riuscito");
    } finally {
      setUploading(false);
    }
  };

  const deleteFile = async (file: StorageFile) => {
    const objectPath = `${folder}/${file.name}`;
    const confirmed = window.confirm(`Eliminare ${file.name}?`);
    if (!confirmed) return;

    try {
      const { error } = await supabase.storage.from(preset.bucket).remove([objectPath]);
      if (error) throw error;
      toast.success("Media eliminato");
      await fetchFiles();
    } catch (error) {
      if (await handleAuthFailure(error)) return;
      console.error("Failed to delete media", error);
      toast.error("Eliminazione non riuscita");
    }
  };

  const copyToClipboard = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copiato");
    } catch {
      toast.error("Copia non riuscita");
    }
  };

  return (
    <div className="min-h-screen pt-24 pb-16 px-6 md:px-12">
      <div className="max-w-7xl mx-auto space-y-8">
        <section className="glass-panel rounded-[34px] px-6 py-8 md:px-10 md:py-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <Link
                to="/admin"
                className="glass-chip inline-flex items-center gap-2 px-4 py-2 text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground hover:text-foreground transition-colors mb-5"
              >
                <ArrowLeft size={14} />
                Dashboard
              </Link>
              <div className="glass-chip inline-flex items-center gap-2 px-4 py-2 text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-5">
                <UploadCloud size={14} />
                Supabase Storage
              </div>
              <h1 className="editorial-heading text-4xl md:text-6xl mb-4">Media Console</h1>
              <p className="max-w-2xl text-sm md:text-base font-sans text-foreground/72 leading-relaxed">
                Carica video e immagini direttamente nei bucket Supabase usati dal sito. La home legge automaticamente i media da
                homepage-media/hero-horizontal e homepage-media/hero-vertical.
              </p>
            </div>

            <Button
              type="button"
              onClick={() => void ensureBuckets()}
              disabled={ensuringBuckets}
              className="glass-chip bg-transparent text-foreground hover:text-accent"
            >
              {ensuringBuckets ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}
              Verifica bucket
            </Button>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.85fr_2.15fr]">
          <aside className="glass-panel rounded-[30px] p-5 md:p-6 h-fit space-y-5">
            <div>
              <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-2">Destinazione</p>
              <div className="space-y-2">
                {MEDIA_PRESETS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setPresetId(item.id);
                      setCustomFolder("");
                    }}
                    className={`w-full rounded-[20px] border px-4 py-3 text-left transition-colors ${
                      presetId === item.id
                        ? "border-accent bg-accent/10"
                        : "border-border/70 bg-background/50 hover:border-accent/60"
                    }`}
                  >
                    <span className="block text-sm font-sans text-foreground">{item.label}</span>
                    <span className="mt-1 block text-xs font-sans text-muted-foreground">{item.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground">Cartella</label>
              <Input
                value={customFolder}
                onChange={(event) => setCustomFolder(event.target.value)}
                placeholder={preset.folder}
                className="rounded-[18px] bg-white/75"
              />
              <p className="text-xs font-sans text-muted-foreground break-all">
                {preset.bucket}/{folder}
              </p>
            </div>
          </aside>

          <main className="glass-panel rounded-[30px] p-5 md:p-6 lg:p-8 space-y-7">
            <div className="glass-panel-soft rounded-[26px] p-5 md:p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="space-y-2">
                  <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground">Upload</p>
                  <h2 className="editorial-heading text-3xl">Carica media</h2>
                  <p className="text-sm font-sans text-muted-foreground">
                    I file vengono caricati nel bucket pubblico selezionato e sono subito disponibili tramite URL Supabase.
                  </p>
                </div>
                <Button
                  type="button"
                  onClick={() => void uploadFiles()}
                  disabled={uploading || !selectedFiles?.length}
                  className="glass-chip bg-transparent text-foreground hover:text-accent"
                >
                  {uploading ? <Loader2 className="animate-spin" size={16} /> : <UploadCloud size={16} />}
                  Carica
                </Button>
              </div>

              <div className="mt-5">
                <Input
                  key={`${preset.id}-${selectedFiles?.length ?? 0}`}
                  type="file"
                  multiple
                  accept={preset.accept}
                  onChange={(event) => setSelectedFiles(event.target.files)}
                  className="rounded-[18px] bg-white/75 file:mr-4 file:rounded-[12px] file:bg-stone-100 file:px-3 file:py-1.5"
                />
              </div>

              {lastUploadedUrls.length > 0 && (
                <div className="mt-5 rounded-[22px] border border-accent/30 bg-accent/5 p-4 space-y-2">
                  <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground">Ultimi URL</p>
                  {lastUploadedUrls.map((url) => (
                    <div key={url} className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded-[14px] bg-white/70 px-3 py-2 text-xs">{url}</code>
                      <Button type="button" variant="ghost" size="icon" onClick={() => void copyToClipboard(url)}>
                        <Copy size={16} />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-2">Contenuto bucket</p>
                  <h2 className="editorial-heading text-3xl">File</h2>
                </div>
                <Button
                  type="button"
                  onClick={() => void fetchFiles()}
                  disabled={loading}
                  variant="ghost"
                  className="glass-chip"
                >
                  {loading ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
                  Aggiorna
                </Button>
              </div>

              {loading ? (
                <div className="space-y-3 animate-pulse">
                  <div className="glass-panel-soft rounded-[22px] h-20" />
                  <div className="glass-panel-soft rounded-[22px] h-20" />
                </div>
              ) : files.length === 0 ? (
                <div className="glass-panel-soft rounded-[24px] p-8 text-center text-sm font-sans text-muted-foreground">
                  Nessun file in questa cartella.
                </div>
              ) : (
                <div className="space-y-3">
                  {files.map((file) => {
                    const objectPath = `${folder}/${file.name}`;
                    const publicUrl = buildPublicUrl(objectPath);
                    return (
                      <article key={file.name} className="glass-panel-soft rounded-[24px] p-4">
                        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                          <div className="min-w-0 flex items-center gap-3">
                            <span className="glass-chip inline-flex h-10 w-10 shrink-0 items-center justify-center text-muted-foreground">
                              {getKindIcon(file)}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-sans text-foreground">{file.name}</p>
                              <p className="mt-1 text-xs font-sans text-muted-foreground">
                                {formatBytes(file.metadata?.size)} · {file.metadata?.mimetype ?? "media"}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <Button type="button" variant="ghost" size="icon" onClick={() => void copyToClipboard(objectPath)} title="Copia path">
                              <Copy size={16} />
                            </Button>
                            <Button type="button" variant="ghost" size="icon" onClick={() => void copyToClipboard(publicUrl)} title="Copia URL">
                              <ExternalLink size={16} />
                            </Button>
                            <Button type="button" variant="ghost" size="icon" onClick={() => void deleteFile(file)} title="Elimina">
                              <Trash2 size={16} />
                            </Button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </main>
        </section>
      </div>
    </div>
  );
};

export default AdminMedia;
