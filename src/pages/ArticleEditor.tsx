import { useState, useEffect, useCallback, useRef, type RefObject } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import RichTextEditor from "@/components/admin/RichTextEditor";
import AuthorSelector from "@/components/AuthorSelector";
import type { Json } from "@/integrations/supabase/types";
import { ArrowLeft, Save, Send, Image as ImageIcon, X, Plus, MapPin, Navigation, Search as SearchIcon } from "lucide-react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { geocodePlace } from "@/lib/voyage-utils";
import type { Voyage, VoyageWaypoint } from "@/lib/voyage-utils";
import { toast } from "sonner";
import { validateSessionOrSignOut, isAuthFailureError } from "@/lib/supabase-auth";
import CoverFocalPicker from "@/components/admin/CoverFocalPicker";
import { clampCoverFocal, coverImageStyle, DEFAULT_COVER_FOCAL, type CoverFocal } from "@/lib/article-cover";

type ArticleLanguage = "en" | "it";

const ArticleEditor = () => {
  const { id } = useParams();
  const isNew = id === "new";
  const navigate = useNavigate();
  const coverInputRef = useRef<HTMLInputElement>(null);
  const instagramEnInputRef = useRef<HTMLInputElement>(null);
  const instagramItInputRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"en" | "it">("en");
  const [titleEn, setTitleEn] = useState("");
  const [titleIt, setTitleIt] = useState("");
  const [slug, setSlug] = useState("");
  const [excerptEn, setExcerptEn] = useState("");
  const [excerptIt, setExcerptIt] = useState("");
  const [contentEn, setContentEn] = useState<object>({});
  const [contentIt, setContentIt] = useState<object>({});
  const [coverImage, setCoverImage] = useState("");
  const [instagramStoryImageEn, setInstagramStoryImageEn] = useState("");
  const [instagramStoryImageIt, setInstagramStoryImageIt] = useState("");
  const [instagramStoryUseCoverEn, setInstagramStoryUseCoverEn] = useState(true);
  const [instagramStoryUseCoverIt, setInstagramStoryUseCoverIt] = useState(true);
  const [coverFocal, setCoverFocal] = useState<CoverFocal>({ ...DEFAULT_COVER_FOCAL });
  const [category, setCategory] = useState("Notes from the Boat");
  const [publishDate, setPublishDate] = useState("");
  const [authorIds, setAuthorIds] = useState<string[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Tags
  const [allTags, setAllTags] = useState<{ id: string; name: string }[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState("");

  // Stories
  const [allStories, setAllStories] = useState<{ id: string; title_en: string; title_it: string; slug: string }[]>([]);
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null);

  // Geo / Voyage
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [locationName, setLocationName] = useState("");
  const [selectedVoyageId, setSelectedVoyageId] = useState<string | null>(null);
  const [voyageSegStart, setVoyageSegStart] = useState<number | null>(null);
  const [voyageSegEnd, setVoyageSegEnd] = useState<number | null>(null);
  const [allVoyages, setAllVoyages] = useState<Voyage[]>([]);
  const [voyageWaypoints, setVoyageWaypoints] = useState<VoyageWaypoint[]>([]);
  const [geoSearchQuery, setGeoSearchQuery] = useState("");
  const [geoSearching, setGeoSearching] = useState(false);
  const geoMapRef = useRef<HTMLDivElement>(null);
  const geoMapInstanceRef = useRef<maplibregl.Map | null>(null);
  const geoMarkerRef = useRef<maplibregl.Marker | null>(null);
  const [associationMode, setAssociationMode] = useState<"point" | "segment" | "full">("point");
  const segmentClicksRef = useRef<number[]>([]);

  useEffect(() => { init(); }, [id]);

  const loginPath = () => navigate("/login", { state: { from: `/admin/article/${id}` } });

  const init = async () => {
    const { session } = await validateSessionOrSignOut();
    if (!session) {
      loginPath();
      return;
    }
    setCurrentUserId(session.user.id);

    // Load tags, stories, and voyages
    const [tagsRes, storiesRes, voyagesRes] = await Promise.all([
      supabase.from("tags").select("*").order("name"),
      supabase.from("stories").select("id, title_en, title_it, slug").order("title_en"),
      supabase.from("voyages").select("*").order("sort_order", { ascending: true }),
    ]);
    setAllTags(tagsRes.data || []);
    setAllStories(storiesRes.data || []);
    setAllVoyages((voyagesRes.data || []) as unknown as Voyage[]);

    if (isNew) {
      setAuthorIds([session.user.id]);
      setPublishDate(new Date().toISOString().slice(0, 16));
    } else {
      loadArticle(session.user.id);
    }
  };

  const loadArticle = async (userId: string) => {
    const { data, error } = await supabase.from("logbook_articles").select("*").eq("id", id).single();
    if (error && isAuthFailureError(error)) {
      await supabase.auth.signOut();
      loginPath();
      return;
    }
    if (error || !data) {
      navigate("/admin");
      return;
    }
    setTitleEn(data.title_en || "");
    setTitleIt(data.title_it || "");
    setSlug(data.slug || "");
    setExcerptEn(data.excerpt_en || "");
    setExcerptIt(data.excerpt_it || "");
    setContentEn(data.content_en as object || {});
    setContentIt(data.content_it as object || {});
    setCoverImage(data.cover_image || "");
    setInstagramStoryImageEn((data as any).instagram_story_image_en || "");
    setInstagramStoryImageIt((data as any).instagram_story_image_it || "");
    setInstagramStoryUseCoverEn((data as any).instagram_story_use_cover_en ?? true);
    setInstagramStoryUseCoverIt((data as any).instagram_story_use_cover_it ?? true);
    setCoverFocal(
      clampCoverFocal(
        Number((data as any).cover_focal_x ?? DEFAULT_COVER_FOCAL.focalX),
        Number((data as any).cover_focal_y ?? DEFAULT_COVER_FOCAL.focalY),
        Number((data as any).cover_zoom ?? DEFAULT_COVER_FOCAL.zoom)
      )
    );
    setCategory(data.category || "Notes from the Boat");
    setPublishDate(data.published_at ? new Date(data.published_at).toISOString().slice(0, 16) : data.scheduled_at ? new Date(data.scheduled_at).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16));
    setSelectedStoryId((data as any).story_id || null);
    setLatitude((data as any).latitude || null);
    setLongitude((data as any).longitude || null);
    setLocationName((data as any).location_name || "");
    setSelectedVoyageId((data as any).voyage_id || null);
    setVoyageSegStart((data as any).voyage_segment_start ?? null);
    setVoyageSegEnd((data as any).voyage_segment_end ?? null);

    // Load waypoints if voyage selected
    if ((data as any).voyage_id) {
      const { data: wps } = await supabase.from("voyage_waypoints").select("*").eq("voyage_id", (data as any).voyage_id).order("sort_order", { ascending: true });
      setVoyageWaypoints((wps || []) as unknown as VoyageWaypoint[]);
    }

    // Load authors and tags
    const [authorsRes, tagsRes] = await Promise.all([
      supabase.from("article_authors").select("profile_id").eq("article_id", id),
      supabase.from("article_tags").select("tag_id").eq("article_id", id),
    ]);
    if (authorsRes.data?.length) setAuthorIds(authorsRes.data.map((a) => a.profile_id));
    else setAuthorIds([userId]);
    if (tagsRes.data?.length) setSelectedTagIds(tagsRes.data.map((t) => t.tag_id));
  };

  const generateSlug = (title: string) =>
    title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 80);

  const handleTitleEnChange = (val: string) => {
    setTitleEn(val);
    if (isNew || !slug) setSlug(generateSlug(val));
  };

  const uploadArticleImage = async (file: File, folder: string, errorMessage: string) => {
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("logbook-media").upload(path, file);
    if (error) {
      console.error("Article image upload error:", error);
      toast.error(errorMessage);
      if (isAuthFailureError(error)) {
        await supabase.auth.signOut();
        loginPath();
      }
      return null;
    }
    const { data: urlData } = supabase.storage.from("logbook-media").getPublicUrl(path);
    return urlData.publicUrl;
  };

  const handleCoverUpload = async (file: File) => {
    const publicUrl = await uploadArticleImage(file, "covers", "Upload copertina non riuscito.");
    if (!publicUrl) return;
    setCoverImage(publicUrl);
    setCoverFocal({ ...DEFAULT_COVER_FOCAL });
  };

  const handleInstagramStoryUpload = async (language: ArticleLanguage, file: File) => {
    const publicUrl = await uploadArticleImage(
      file,
      `instagram-stories/${language}`,
      "Upload immagine Instagram Stories non riuscito."
    );
    if (!publicUrl) return;

    if (language === "en") {
      setInstagramStoryImageEn(publicUrl);
      setInstagramStoryUseCoverEn(false);
      return;
    }

    setInstagramStoryImageIt(publicUrl);
    setInstagramStoryUseCoverIt(false);
  };

  const addNewTag = async () => {
    const raw = newTagInput.trim();
    const name = raw
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    if (!name) {
      toast.message("Inserisci un tag valido (lettere e numeri).");
      return;
    }
    const existing = allTags.find((t) => t.name.toLowerCase() === name);
    if (existing) {
      if (!selectedTagIds.includes(existing.id)) setSelectedTagIds((prev) => [...prev, existing.id]);
      setNewTagInput("");
      return;
    }
    const { data, error } = await supabase.from("tags").insert({ name }).select().single();
    if (error) {
      if (error.code === "23505") {
        const { data: refreshed } = await supabase.from("tags").select("*").order("name");
        if (refreshed?.length) {
          setAllTags(refreshed);
          const t = refreshed.find((x) => x.name.toLowerCase() === name);
          if (t && !selectedTagIds.includes(t.id)) setSelectedTagIds((prev) => [...prev, t.id]);
        }
        setNewTagInput("");
        return;
      }
      console.error(error);
      toast.error("Impossibile aggiungere il tag. Controlla di essere autenticato.");
      if (isAuthFailureError(error)) {
        await supabase.auth.signOut();
        loginPath();
      }
      return;
    }
    if (data) {
      setAllTags((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedTagIds((prev) => [...prev, data.id]);
    }
    setNewTagInput("");
  };

  const saveArticle = useCallback(async (action: "draft" | "publish") => {
    setSaving(true);
    const { session: live } = await validateSessionOrSignOut();
    if (!live) {
      toast.error("Sessione non valida. Effettua di nuovo l’accesso.");
      navigate("/login", { state: { from: `/admin/article/${id}` } });
      setSaving(false);
      return;
    }
    const selectedDate = publishDate ? new Date(publishDate) : new Date();
    const now = new Date();
    const isFuture = selectedDate > now;

    let finalStatus: "draft" | "scheduled" | "published";
    let publishedAt: string | null = null;
    let scheduledAt: string | null = null;

    if (action === "draft") {
      finalStatus = "draft";
    } else if (isFuture) {
      finalStatus = "scheduled";
      scheduledAt = selectedDate.toISOString();
    } else {
      finalStatus = "published";
      publishedAt = selectedDate.toISOString();
    }

    const articleData: any = {
      title_en: titleEn,
      title_it: titleIt,
      slug,
      excerpt_en: excerptEn,
      excerpt_it: excerptIt,
      content_en: contentEn as Json,
      content_it: contentIt as Json,
      cover_image: coverImage,
      instagram_story_image_en: instagramStoryImageEn || null,
      instagram_story_image_it: instagramStoryImageIt || null,
      instagram_story_use_cover_en: instagramStoryUseCoverEn,
      instagram_story_use_cover_it: instagramStoryUseCoverIt,
      category,
      status: finalStatus,
      published_at: publishedAt,
      scheduled_at: scheduledAt,
      story_id: selectedStoryId || null,
      latitude,
      longitude,
      location_name: locationName || null,
      voyage_id: selectedVoyageId || null,
      voyage_segment_start: voyageSegStart,
      voyage_segment_end: voyageSegEnd,
      cover_focal_x: coverFocal.focalX,
      cover_focal_y: coverFocal.focalY,
      cover_zoom: coverFocal.zoom,
    };

    let articleId = id;
    if (isNew) {
      const { data, error } = await supabase.from("logbook_articles").insert(articleData).select().single();
      if (error) {
        console.error("Article insert failed:", error);
        if (isAuthFailureError(error)) {
          await supabase.auth.signOut();
          navigate("/login", { state: { from: `/admin/article/new` } });
        } else toast.error("Salvataggio non riuscito.");
        setSaving(false);
        return;
      }
      if (data) {
        articleId = data.id;
        const stayForPublishedView = action === "publish" && finalStatus === "published";
        if (!stayForPublishedView) {
          navigate(`/admin/article/${data.id}`, { replace: true });
        }
      }
    } else {
      const { error: upErr } = await supabase.from("logbook_articles").update(articleData).eq("id", id);
      if (upErr) {
        console.error("Article update failed:", upErr);
        if (isAuthFailureError(upErr)) {
          await supabase.auth.signOut();
          navigate("/login", { state: { from: `/admin/article/${id}` } });
        } else toast.error("Salvataggio non riuscito.");
        setSaving(false);
        return;
      }
    }

    // Save authors and tags
    if (articleId && articleId !== "new") {
      const [authorsDeleteRes, tagsDeleteRes] = await Promise.all([
        supabase.from("article_authors").delete().eq("article_id", articleId),
        supabase.from("article_tags").delete().eq("article_id", articleId),
      ]);

      const relationDeleteError = authorsDeleteRes.error || tagsDeleteRes.error;
      if (relationDeleteError) {
        console.error("Article relation cleanup failed:", relationDeleteError);
        toast.error("Salvataggio autori o tag non riuscito.");
        setSaving(false);
        return;
      }

      const inserts = [];
      if (authorIds.length > 0) {
        inserts.push(supabase.from("article_authors").insert(
          authorIds.map((profileId) => ({ article_id: articleId!, profile_id: profileId }))
        ));
      }
      if (selectedTagIds.length > 0) {
        inserts.push(supabase.from("article_tags").insert(
          selectedTagIds.map((tagId) => ({ article_id: articleId!, tag_id: tagId }))
        ));
      }
      const insertResults = inserts.length ? await Promise.all(inserts) : [];
      const relationInsertError = insertResults.find((result) => result.error)?.error;
      if (relationInsertError) {
        console.error("Article relation save failed:", relationInsertError);
        toast.error("Salvataggio autori o tag non riuscito.");
        setSaving(false);
        return;
      }

      // Send email notifications to story subscribers when publishing a new chapter
      if (finalStatus === "published" && selectedStoryId && articleId) {
        try {
          // Get story info
          const story = allStories.find((s) => s.id === selectedStoryId);
          // Get subscribers' profile_ids
          const { data: subs } = await supabase
            .from("story_subscriptions")
            .select("profile_id")
            .eq("story_id", selectedStoryId);
          if (subs && subs.length > 0) {
            const origin = window.location.origin;
            await supabase.functions.invoke("notify-story-subscribers", {
              body: {
                storyId: selectedStoryId,
                articleId,
                storyTitle: story?.title_en || "",
                chapterTitle: titleEn,
                chapterUrl: `${origin}/logbook/${slug}`,
                storyUrl: `${origin}/logbook/story/${story?.slug || ""}`,
              },
            });
          }
        } catch (e) {
          console.error("Failed to send story notifications:", e);
        }
      }
    }

    if (action === "publish" && finalStatus === "published" && articleId && articleId !== "new" && slug?.trim()) {
      window.location.assign(`${window.location.origin}/logbook/${encodeURIComponent(slug.trim())}`);
      return;
    }

    setSaving(false);
  }, [titleEn, titleIt, slug, excerptEn, excerptIt, contentEn, contentIt, coverImage, instagramStoryImageEn, instagramStoryImageIt, instagramStoryUseCoverEn, instagramStoryUseCoverIt, coverFocal, category, publishDate, authorIds, selectedTagIds, selectedStoryId, latitude, longitude, locationName, selectedVoyageId, voyageSegStart, voyageSegEnd, id, isNew, navigate, allStories]);

  // Geo map initialization
  useEffect(() => {
    if (!geoMapRef.current || geoMapInstanceRef.current) return;
    const map = new maplibregl.Map({
      container: geoMapRef.current,
      style: {
        version: 8,
        sources: { carto: { type: "raster", tiles: ["https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png"], tileSize: 256 } },
        layers: [{ id: "carto", type: "raster", source: "carto", minzoom: 0, maxzoom: 20 }],
      },
      center: [longitude || 15, latitude || 40],
      zoom: latitude ? 10 : 5,
      attributionControl: false,
    });
    geoMapInstanceRef.current = map;
    map.once("load", () => requestAnimationFrame(() => map.resize()));

    // Add existing pin if any
    if (latitude && longitude) {
      geoMarkerRef.current = new maplibregl.Marker({ color: "hsl(210,60%,45%)" })
        .setLngLat([longitude, latitude])
        .addTo(map);
    }

    map.on("click", (e) => {
      const lat = e.lngLat.lat;
      const lng = e.lngLat.lng;
      setLatitude(lat);
      setLongitude(lng);
      geoMarkerRef.current?.remove();
      geoMarkerRef.current = new maplibregl.Marker({ color: "hsl(210,60%,45%)" })
        .setLngLat([lng, lat])
        .addTo(map);
    });

    return () => { map.remove(); geoMapInstanceRef.current = null; };
  }, []);

  // Load voyage waypoints when voyage changes
  useEffect(() => {
    if (!selectedVoyageId) { setVoyageWaypoints([]); return; }
    (async () => {
      const { data } = await supabase.from("voyage_waypoints").select("*").eq("voyage_id", selectedVoyageId).order("sort_order", { ascending: true });
      setVoyageWaypoints((data || []) as unknown as VoyageWaypoint[]);
    })();
  }, [selectedVoyageId]);

  // Draw voyage route on geo map
  useEffect(() => {
    const map = geoMapInstanceRef.current;
    if (!map) return;
    const draw = () => {
      if (map.getLayer("editor-route")) map.removeLayer("editor-route");
      if (map.getSource("editor-route")) map.removeSource("editor-route");
      if (voyageWaypoints.length < 2) return;
      map.addSource("editor-route", {
        type: "geojson",
        data: { type: "Feature", geometry: { type: "LineString", coordinates: voyageWaypoints.map((w) => [w.lng, w.lat]) }, properties: {} },
      });
      map.addLayer({
        id: "editor-route",
        type: "line",
        source: "editor-route",
        paint: { "line-color": "hsl(210,60%,45%)", "line-width": 3, "line-opacity": 0.6 },
      });
    };
    if (map.isStyleLoaded()) draw();
    else map.on("load", draw);
  }, [voyageWaypoints]);

  const handleGeoSearch = async () => {
    if (!geoSearchQuery.trim()) return;
    setGeoSearching(true);
    const result = await geocodePlace(geoSearchQuery);
    setGeoSearching(false);
    if (result) {
      setLatitude(result.lat);
      setLongitude(result.lng);
      setLocationName(result.name.split(",")[0]);
      const map = geoMapInstanceRef.current;
      if (map) {
        geoMarkerRef.current?.remove();
        geoMarkerRef.current = new maplibregl.Marker({ color: "hsl(210,60%,45%)" })
          .setLngLat([result.lng, result.lat])
          .addTo(map);
        map.flyTo({ center: [result.lng, result.lat], zoom: 12 });
      }
    }
  };

  const selectedDate = publishDate ? new Date(publishDate) : new Date();
  const isFuture = selectedDate > new Date();

  const renderInstagramStorySection = ({
    language,
    label,
    useCover,
    customImage,
    setUseCover,
    setCustomImage,
    inputRef,
  }: {
    language: ArticleLanguage;
    label: string;
    useCover: boolean;
    customImage: string;
    setUseCover: (value: boolean) => void;
    setCustomImage: (value: string) => void;
    inputRef: RefObject<HTMLInputElement>;
  }) => {
    const previewImage = useCover ? coverImage : customImage;

    return (
      <div className="border border-border p-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-sans tracking-[0.18em] uppercase text-muted-foreground">{label}</p>
          <div className="inline-flex border border-border">
            <button
              type="button"
              onClick={() => setUseCover(true)}
              className={`px-2.5 py-1 text-[11px] font-sans transition-colors ${useCover ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
            >
              Use cover
            </button>
            <button
              type="button"
              onClick={() => setUseCover(false)}
              className={`px-2.5 py-1 text-[11px] font-sans transition-colors ${!useCover ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
            >
              Custom image
            </button>
          </div>
        </div>

        {previewImage ? (
          <div className="relative aspect-[9/16] overflow-hidden border border-border bg-muted">
            <img src={previewImage} alt={`${label} Instagram Story`} className="h-full w-full object-cover" />
            {!useCover && (
              <button
                type="button"
                onClick={() => setCustomImage("")}
                className="absolute top-2 right-2 bg-primary/80 text-primary-foreground px-2 py-1 text-xs"
              >
                Remove
              </button>
            )}
          </div>
        ) : (
          <div className="aspect-[9/16] border border-dashed border-border flex items-center justify-center px-4 text-center text-xs text-muted-foreground">
            {useCover ? "No cover image selected yet." : "Upload a dedicated image for Instagram Stories."}
          </div>
        )}

        {useCover ? (
          <p className="text-[11px] text-muted-foreground">
            Instagram Stories will use the current cover image for the {label.toLowerCase()} article version.
          </p>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-2 border border-border px-3 py-2 text-xs font-sans text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
            >
              <ImageIcon size={14} />
              {customImage ? "Replace image" : "Upload image"}
            </button>
            {customImage && (
              <button
                type="button"
                onClick={() => setCustomImage("")}
                className="inline-flex items-center gap-2 border border-border px-3 py-2 text-xs font-sans text-muted-foreground hover:text-destructive hover:border-destructive transition-colors"
              >
                <X size={14} />
                Remove
              </button>
            )}
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleInstagramStoryUpload(language, file);
            e.target.value = "";
          }}
        />
      </div>
    );
  };

  return (
    <div className="min-h-screen pt-24 pb-16 px-6 md:px-12">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <button onClick={() => navigate("/admin")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={16} /> Back
          </button>
          <div className="flex items-center gap-3">
            <button onClick={() => saveArticle("draft")} disabled={saving} className="inline-flex items-center gap-2 border border-border px-4 py-2 text-sm font-sans hover:bg-muted transition-colors disabled:opacity-50">
              <Save size={14} /> Save Draft
            </button>
            <button onClick={() => saveArticle("publish")} disabled={saving} className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2 text-sm font-sans font-medium hover:bg-navy-light transition-colors disabled:opacity-50">
              <Send size={14} /> {isFuture ? "Schedule" : "Publish"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8">
          {/* Main content */}
          <div className="space-y-6">
            <div className="flex gap-4 border-b border-border">
              <button onClick={() => setActiveTab("en")} className={`pb-3 text-sm font-sans tracking-wide transition-colors border-b-2 ${activeTab === "en" ? "border-foreground text-foreground" : "border-transparent text-muted-foreground"}`}>English</button>
              <button onClick={() => setActiveTab("it")} className={`pb-3 text-sm font-sans tracking-wide transition-colors border-b-2 ${activeTab === "it" ? "border-foreground text-foreground" : "border-transparent text-muted-foreground"}`}>Italiano</button>
            </div>

            {activeTab === "en" ? (
              <input type="text" value={titleEn} onChange={(e) => handleTitleEnChange(e.target.value)} placeholder="Article title (English)" className="w-full bg-transparent font-serif text-3xl md:text-4xl font-bold focus:outline-none placeholder:text-muted-foreground/30" />
            ) : (
              <input type="text" value={titleIt} onChange={(e) => setTitleIt(e.target.value)} placeholder="Titolo articolo (Italiano)" className="w-full bg-transparent font-serif text-3xl md:text-4xl font-bold focus:outline-none placeholder:text-muted-foreground/30" />
            )}

            {activeTab === "en" ? (
              <textarea value={excerptEn} onChange={(e) => setExcerptEn(e.target.value)} placeholder="Short excerpt (English)..." rows={2} className="w-full bg-transparent border-b border-border py-3 text-foreground/80 font-sans focus:outline-none focus:border-accent transition-colors resize-none" />
            ) : (
              <textarea value={excerptIt} onChange={(e) => setExcerptIt(e.target.value)} placeholder="Breve estratto (Italiano)..." rows={2} className="w-full bg-transparent border-b border-border py-3 text-foreground/80 font-sans focus:outline-none focus:border-accent transition-colors resize-none" />
            )}

            {activeTab === "en" ? (
              <RichTextEditor content={contentEn} onChange={setContentEn} placeholder="Start writing your article in English..." />
            ) : (
              <RichTextEditor content={contentIt} onChange={setContentIt} placeholder="Inizia a scrivere l'articolo in italiano..." />
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Cover image */}
            <div>
              <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-3 block">Cover Image</label>
              {coverImage ? (
                <>
                  <div className="relative aspect-[16/10] overflow-hidden mb-2 group bg-muted border border-border">
                    <img
                      src={coverImage}
                      alt="Cover"
                      className="absolute inset-0 max-w-none pointer-events-none"
                      style={coverImageStyle(coverImage, coverFocal)}
                    />
                    <button
                      type="button"
                      onClick={() => { setCoverImage(""); setCoverFocal({ ...DEFAULT_COVER_FOCAL }); }}
                      className="absolute top-2 right-2 bg-primary/80 text-primary-foreground px-2 py-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity z-10"
                    >
                      Remove
                    </button>
                  </div>
                  <CoverFocalPicker imageUrl={coverImage} value={coverFocal} onChange={setCoverFocal} />
                </>
              ) : (
                <button type="button" onClick={() => coverInputRef.current?.click()} className="w-full aspect-[16/10] border-2 border-dashed border-border flex items-center justify-center text-muted-foreground hover:border-accent hover:text-accent transition-colors">
                  <ImageIcon size={24} />
                </button>
              )}
              <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleCoverUpload(file); e.target.value = ""; }} />
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Instagram Stories</label>
                <p className="text-[11px] text-muted-foreground">
                  Per il web share proviamo a passare immagine + link articolo sui browser mobile che supportano la condivisione file.
                </p>
              </div>
              {renderInstagramStorySection({
                language: "en",
                label: "English",
                useCover: instagramStoryUseCoverEn,
                customImage: instagramStoryImageEn,
                setUseCover: setInstagramStoryUseCoverEn,
                setCustomImage: setInstagramStoryImageEn,
                inputRef: instagramEnInputRef,
              })}
              {renderInstagramStorySection({
                language: "it",
                label: "Italiano",
                useCover: instagramStoryUseCoverIt,
                customImage: instagramStoryImageIt,
                setUseCover: setInstagramStoryUseCoverIt,
                setCustomImage: setInstagramStoryImageIt,
                inputRef: instagramItInputRef,
              })}
            </div>

            {/* Slug */}
            <div>
              <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">Slug</label>
              <input type="text" value={slug} onChange={(e) => setSlug(e.target.value)} className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent transition-colors" />
            </div>

            {/* Tags */}
            <div>
              <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">Tags</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {selectedTagIds.map((tagId) => {
                  const tag = allTags.find((t) => t.id === tagId);
                  if (!tag) return null;
                  return (
                    <span key={tag.id} className="inline-flex items-center gap-1 text-xs font-sans bg-accent/10 text-accent px-2 py-1 border border-accent/20">
                      #{tag.name}
                      <button onClick={() => setSelectedTagIds((prev) => prev.filter((id) => id !== tagId))} className="hover:text-foreground">
                        <X size={10} />
                      </button>
                    </span>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addNewTag())}
                  placeholder="Add tag..."
                  className="flex-1 bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                  list="tag-suggestions"
                />
                <datalist id="tag-suggestions">
                  {allTags.filter((t) => !selectedTagIds.includes(t.id)).map((t) => (
                    <option key={t.id} value={t.name} />
                  ))}
                </datalist>
                <button type="button" onClick={() => void addNewTag()} className="border border-border px-2 py-2 text-muted-foreground hover:text-foreground hover:border-foreground transition-colors">
                  <Plus size={14} />
                </button>
              </div>
            </div>

            {/* Story */}
            <div>
              <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">Story</label>
              <select
                value={selectedStoryId || ""}
                onChange={(e) => setSelectedStoryId(e.target.value || null)}
                className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
              >
                <option value="">No story (standalone post)</option>
                {allStories.map((s) => (
                  <option key={s.id} value={s.id}>{s.title_en || s.title_it}</option>
                ))}
              </select>
            </div>

            {/* Publish date */}
            <div>
              <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">
                {isFuture ? "Schedule for" : "Publish date"}
              </label>
              <input type="datetime-local" value={publishDate} onChange={(e) => setPublishDate(e.target.value)} className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent transition-colors" />
              {isFuture && <p className="text-xs text-amber-600 mt-1">This article will be scheduled for future publication.</p>}
            </div>

            {/* Location & Voyage */}
            <div>
              <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">
                <MapPin size={12} className="inline mr-1" /> Location & Voyage
              </label>

              {/* Geo search */}
              <div className="flex gap-1.5 mb-2">
                <input
                  type="text"
                  value={geoSearchQuery}
                  onChange={(e) => setGeoSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleGeoSearch())}
                  placeholder="Search place..."
                  className="flex-1 bg-transparent border border-border px-2 py-1.5 text-xs font-sans focus:outline-none focus:border-accent transition-colors"
                />
                <button onClick={handleGeoSearch} disabled={geoSearching} className="border border-border px-2 py-1.5 text-muted-foreground hover:text-foreground transition-colors">
                  <SearchIcon size={12} />
                </button>
              </div>

              {/* Mini map */}
              <div ref={geoMapRef} className="w-full aspect-[4/3] border border-border mb-2" />

              {/* Location name */}
              <input
                type="text"
                value={locationName}
                onChange={(e) => setLocationName(e.target.value)}
                placeholder="Location name (e.g. Porto di Bari)"
                className="w-full bg-transparent border border-border px-2 py-1.5 text-xs font-sans focus:outline-none focus:border-accent transition-colors mb-2"
              />

              {/* Coordinates display */}
              {latitude && longitude && (
                <p className="text-[10px] font-sans text-muted-foreground mb-2">
                  📍 {latitude.toFixed(4)}, {longitude.toFixed(4)}
                  <button onClick={() => { setLatitude(null); setLongitude(null); geoMarkerRef.current?.remove(); }} className="ml-2 text-destructive hover:underline">Clear</button>
                </p>
              )}

              {/* Voyage selector */}
              <div className="mt-3">
                <label className="text-[10px] font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">
                  <Navigation size={10} className="inline mr-1" /> Voyage
                </label>
                <select
                  value={selectedVoyageId || ""}
                  onChange={(e) => {
                    setSelectedVoyageId(e.target.value || null);
                    setVoyageSegStart(null);
                    setVoyageSegEnd(null);
                  }}
                  className="w-full bg-transparent border border-border px-2 py-1.5 text-xs font-sans focus:outline-none focus:border-accent transition-colors"
                >
                  <option value="">No voyage</option>
                  {allVoyages.map((v) => (
                    <option key={v.id} value={v.id}>{v.type === "water" ? "🚢" : "🚐"} {v.name}</option>
                  ))}
                </select>
              </div>

              {/* Association mode */}
              {selectedVoyageId && (
                <div className="mt-2 space-y-1.5">
                  <label className="text-[10px] font-sans tracking-[0.2em] uppercase text-muted-foreground block">Association</label>
                  <div className="flex gap-1">
                    <button
                      onClick={() => { setAssociationMode("full"); setVoyageSegStart(null); setVoyageSegEnd(null); }}
                      className={`px-2 py-1 text-[10px] font-sans border transition-colors ${associationMode === "full" ? "bg-accent text-accent-foreground border-accent" : "border-border text-muted-foreground hover:text-foreground"}`}
                    >
                      Full voyage
                    </button>
                    <button
                      onClick={() => setAssociationMode("point")}
                      className={`px-2 py-1 text-[10px] font-sans border transition-colors ${associationMode === "point" ? "bg-accent text-accent-foreground border-accent" : "border-border text-muted-foreground hover:text-foreground"}`}
                    >
                      Point
                    </button>
                    <button
                      onClick={() => setAssociationMode("segment")}
                      className={`px-2 py-1 text-[10px] font-sans border transition-colors ${associationMode === "segment" ? "bg-accent text-accent-foreground border-accent" : "border-border text-muted-foreground hover:text-foreground"}`}
                    >
                      Segment
                    </button>
                  </div>

                  {associationMode === "point" && latitude && (
                    <p className="text-[10px] text-muted-foreground">
                      Point set at {latitude.toFixed(4)}, {longitude?.toFixed(4)}
                    </p>
                  )}
                  {associationMode === "segment" && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-sans text-muted-foreground block">Start WP #</label>
                        <input type="number" min={0} value={voyageSegStart ?? ""} onChange={(e) => setVoyageSegStart(e.target.value ? Number(e.target.value) : null)} className="w-full bg-transparent border border-border px-2 py-1 text-xs font-sans focus:outline-none focus:border-accent" />
                      </div>
                      <div>
                        <label className="text-[10px] font-sans text-muted-foreground block">End WP #</label>
                        <input type="number" min={0} value={voyageSegEnd ?? ""} onChange={(e) => setVoyageSegEnd(e.target.value ? Number(e.target.value) : null)} className="w-full bg-transparent border border-border px-2 py-1 text-xs font-sans focus:outline-none focus:border-accent" />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Authors */}
            <AuthorSelector selectedIds={authorIds} onChange={setAuthorIds} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ArticleEditor;
