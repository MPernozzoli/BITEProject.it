import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  ImagePlus,
  Loader2,
  Trash2,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import PackPhotoCropDialog from "@/components/admin/PackPhotoCropDialog";
import { supabase } from "@/integrations/supabase/client";
import {
  PACK_GALLERY_BUCKET,
  PACK_GALLERY_CATEGORIES,
  buildPackGalleryObjectPath,
  buildPackGalleryUrl,
  type PackGalleryPhoto,
} from "@/lib/pack-gallery";
import { isAuthFailureError } from "@/lib/supabase-auth";

const AdminPackGallery = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [photos, setPhotos] = useState<PackGalleryPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [cropSourceUrl, setCropSourceUrl] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleAuthFailure = useCallback(
    async (error: unknown) => {
      if (isAuthFailureError(error)) {
        await supabase.auth.signOut();
        navigate("/login", { state: { from: "/admin/pack-gallery" } });
        return true;
      }
      return false;
    },
    [navigate]
  );

  const fetchPhotos = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("pack_gallery_photos" as never)
        .select("*")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      setPhotos((data ?? []) as unknown as PackGalleryPhoto[]);
    } catch (error) {
      if (await handleAuthFailure(error)) return;
      console.error("Failed to load pack gallery", error);
      toast.error("Impossibile leggere la galleria");
    } finally {
      setLoading(false);
    }
  }, [handleAuthFailure]);

  useEffect(() => {
    void fetchPhotos();
  }, [fetchPhotos]);

  // Revokes the source object URL once the crop dialog closes.
  useEffect(
    () => () => {
      if (cropSourceUrl) URL.revokeObjectURL(cropSourceUrl);
    },
    [cropSourceUrl]
  );

  const handleFileSelected = (fileList: FileList | null) => {
    const file = Array.from(fileList ?? []).find((item) => item.type.startsWith("image/"));
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;
    setCropSourceUrl(URL.createObjectURL(file));
  };

  const closeCrop = () => {
    setCropSourceUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
  };

  const handleCropConfirm = async (blob: Blob) => {
    setIsSaving(true);
    const objectPath = buildPackGalleryObjectPath("webp");
    try {
      const { error: uploadError } = await supabase.storage
        .from(PACK_GALLERY_BUCKET)
        .upload(objectPath, blob, {
          cacheControl: "31536000",
          contentType: "image/webp",
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const nextOrder = photos.reduce((max, item) => Math.max(max, item.sort_order), 0) + 1;
      const { error: insertError } = await supabase.from("pack_gallery_photos" as never).insert({
        storage_path: objectPath,
        category: PACK_GALLERY_CATEGORIES[0],
        alt: "",
        sort_order: nextOrder,
        is_published: true,
      } as never);

      if (insertError) {
        await supabase.storage.from(PACK_GALLERY_BUCKET).remove([objectPath]);
        throw insertError;
      }

      toast.success("Foto aggiunta alla galleria");
      closeCrop();
      await fetchPhotos();
    } catch (error) {
      if (await handleAuthFailure(error)) return;
      console.error("Failed to save gallery photo", error);
      toast.error("Salvataggio non riuscito");
    } finally {
      setIsSaving(false);
    }
  };

  const patchPhoto = async (photo: PackGalleryPhoto, patch: Partial<PackGalleryPhoto>) => {
    setPhotos((current) =>
      current.map((item) => (item.id === photo.id ? { ...item, ...patch } : item))
    );
    const { error } = await supabase
      .from("pack_gallery_photos" as never)
      .update(patch as never)
      .eq("id", photo.id);
    if (error) {
      if (await handleAuthFailure(error)) return;
      toast.error("Modifica non salvata");
      await fetchPhotos();
    }
  };

  // Swaps sort_order with the neighbour in the chosen direction.
  const movePhoto = async (index: number, direction: -1 | 1) => {
    const target = photos[index + direction];
    const current = photos[index];
    if (!target || !current) return;

    setPhotos((list) => {
      const next = [...list];
      next[index] = target;
      next[index + direction] = current;
      return next;
    });

    const results = await Promise.all([
      supabase
        .from("pack_gallery_photos" as never)
        .update({ sort_order: target.sort_order } as never)
        .eq("id", current.id),
      supabase
        .from("pack_gallery_photos" as never)
        .update({ sort_order: current.sort_order } as never)
        .eq("id", target.id),
    ]);
    if (results.some((result) => result.error)) {
      toast.error("Ordine non salvato");
      await fetchPhotos();
    }
  };

  const deletePhoto = async (photo: PackGalleryPhoto) => {
    if (!window.confirm("Eliminare questa foto dalla galleria?")) return;

    const { error } = await supabase
      .from("pack_gallery_photos" as never)
      .delete()
      .eq("id", photo.id);
    if (error) {
      if (await handleAuthFailure(error)) return;
      toast.error("Eliminazione non riuscita");
      return;
    }
    await supabase.storage.from(PACK_GALLERY_BUCKET).remove([photo.storage_path]);
    toast.success("Foto eliminata");
    await fetchPhotos();
  };

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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Galleria pack</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                La galleria del sito pack mostra esattamente queste foto, tutte in formato 4:5.
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              className="hidden"
              onChange={(event) => handleFileSelected(event.target.files)}
            />
            <Button onClick={() => fileInputRef.current?.click()}>
              <ImagePlus size={16} className="mr-2" />
              Aggiungi foto
            </Button>
          </div>
        </header>

        {loading ? (
          <div className="flex items-center gap-2 rounded-xl border border-border p-6 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
            Carico…
          </div>
        ) : photos.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Galleria vuota. Aggiungi la prima foto.
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {photos.map((photo, index) => (
              <li
                key={photo.id}
                className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3"
              >
                <div className="relative overflow-hidden rounded-xl">
                  <img
                    src={buildPackGalleryUrl(photo.storage_path)}
                    alt={photo.alt}
                    loading="lazy"
                    className="aspect-[4/5] w-full object-cover"
                  />
                  {!photo.is_published ? (
                    <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white">
                      Nascosta
                    </span>
                  ) : null}
                </div>

                <Select
                  value={photo.category}
                  onValueChange={(value) => void patchPhoto(photo, { category: value })}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PACK_GALLERY_CATEGORIES.map((category) => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Input
                  value={photo.alt}
                  placeholder="Testo alternativo (descrizione)"
                  onChange={(event) =>
                    setPhotos((current) =>
                      current.map((item) =>
                        item.id === photo.id ? { ...item, alt: event.target.value } : item
                      )
                    )
                  }
                  onBlur={(event) => void patchPhoto(photo, { alt: event.target.value })}
                />

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Su"
                      disabled={index === 0}
                      onClick={() => void movePhoto(index, -1)}
                    >
                      <ChevronUp size={16} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Giù"
                      disabled={index === photos.length - 1}
                      onClick={() => void movePhoto(index, 1)}
                    >
                      <ChevronDown size={16} />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      title={photo.is_published ? "Nascondi" : "Pubblica"}
                      onClick={() =>
                        void patchPhoto(photo, { is_published: !photo.is_published })
                      }
                    >
                      {photo.is_published ? <Eye size={16} /> : <EyeOff size={16} />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Elimina"
                      onClick={() => void deletePhoto(photo)}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <PackPhotoCropDialog
        open={Boolean(cropSourceUrl)}
        imageUrl={cropSourceUrl}
        loading={isSaving}
        onOpenChange={(open) => !open && closeCrop()}
        onCancel={closeCrop}
        onConfirm={handleCropConfirm}
      />
    </div>
  );
};

export default AdminPackGallery;
