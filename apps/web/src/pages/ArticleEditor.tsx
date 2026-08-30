import { useState, useEffect, useCallback, useMemo, useRef, type ComponentProps, type RefObject } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import RichTextEditor from "@/components/admin/RichTextEditor";
import ArticleGeoAssociationPanel from "@/components/admin/ArticleGeoAssociationPanel";
import ArticleSeoPanel, { type ArticleSeoOptimization } from "@/components/admin/ArticleSeoPanel";
import ArticlePreviewOverlay from "@/components/admin/ArticlePreviewOverlay";
import ArticleEditorDialogs from "@/components/admin/ArticleEditorDialogs";
import AuthorSelector from "@/components/AuthorSelector";
import type { Json } from "@/integrations/supabase/types";
import { ArrowLeft, Save, Send, Image as ImageIcon, X, Plus, Crop, Languages, Loader2, Sparkles, Eye } from "lucide-react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { createCartoRasterStyle } from "@/lib/maplibre";
import { buildPublicVoyageGeometry, buildVoyageSegmentGeometry, geocodePlace, getWaypointOptionLabel, resolveArticleRouteRange } from "@/lib/voyage-utils";
import type { Voyage, VoyageWaypoint } from "@/lib/voyage-utils";
import { toast } from "sonner";
import { validateSessionOrSignOut, isAuthFailureError } from "@/lib/supabase-auth";
import CoverCropDialog from "@/components/admin/CoverCropDialog";
import ArticleMiniMapEditor from "@/components/admin/ArticleMiniMapEditor";
import { clampCoverFocal, coverImageStyle, DEFAULT_COVER_FOCAL, type CoverFocal } from "@/lib/article-cover";
import { normalizeArticleMapScenes } from "@/lib/article-map";
import { invokeTranslateEditorContent } from "@/lib/translate-editor-content";
import { getArticleTranslationGaps } from "@/lib/article-translation-gaps";
import { EDITORIAL_TYPE_LABELS, type EditorialArticleType } from "@/lib/editorial-plan";
import { useBeforeUnloadPrompt } from "@/hooks/useBeforeUnloadPrompt";
import ArticleReader from "@/components/ArticleReader";
import { useI18n, type Language } from "@/lib/i18n";

type ArticleLanguage = "en" | "it";

const ARTICLE_DRAFT_STORAGE_PREFIX = "bite_article_editor_draft";
const ADMIN_DASH_SECTION_STORAGE_KEY = "bite_admin_dashboard_active_section";


type ArticleEditorDraft = {
  titleEn: string;
  titleIt: string;
  slug: string;
  slugIt: string;
  slugEn: string;
  slugManuallyEdited: boolean;
  slugItManuallyEdited: boolean;
  slugEnManuallyEdited: boolean;
  excerptEn: string;
  excerptIt: string;
  contentEn: object;
  contentIt: object;
  articleMapScenes: ReturnType<typeof normalizeArticleMapScenes>;
  coverImage: string;
  instagramStoryImageEn: string;
  instagramStoryImageIt: string;
  instagramStoryUseCoverEn: boolean;
  instagramStoryUseCoverIt: boolean;
  coverFocal: CoverFocal;
  category: string;
  /** Tipo editoriale interno (vuoto = non classificato) */
  editorialType: "" | EditorialArticleType;
  authorIds: string[];
  selectedTagIds: string[];
  selectedStoryId: string | null;
  latitude: number | null;
  longitude: number | null;
  locationName: string;
  selectedVoyageId: string | null;
  voyageSegStart: number | null;
  voyageSegEnd: number | null;
};

const getSaveErrorMessage = (error: { code?: string; message?: string }, lang: Language) => {
  if (error.code === "23505") {
    return lang === "it" ? "Esiste già un articolo con questo slug." : "An article with this slug already exists.";
  }
  if (error.message?.includes("instagram_story_")) {
    return lang === "it"
      ? "Il database non è aggiornato: applica la migration delle colonne Instagram Stories."
      : "The database is not up to date: apply the migration for the Instagram Stories columns.";
  }
  return lang === "it" ? "Salvataggio non riuscito." : "Save failed.";
};

const inferAssociationMode = (
  voyageId: string | null,
  start: number | null,
  end: number | null,
  lat: number | null,
  lng: number | null
): "point" | "segment" | "full" => {
  if (!voyageId) return "point";
  if (start == null && end == null) {
    return lat != null && lng != null ? "point" : "full";
  }

  const safeStart = start ?? end;
  const safeEnd = end ?? start;
  return safeStart === safeEnd ? "point" : "segment";
};

const ArticleEditor = () => {
  const { id } = useParams();
  const isNew = id === "new";
  const navigate = useNavigate();
  const location = useLocation();
  const { lang } = useI18n();
  const coverInputRef = useRef<HTMLInputElement>(null);
  const instagramEnInputRef = useRef<HTMLInputElement>(null);
  const instagramItInputRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [translationOfferOpen, setTranslationOfferOpen] = useState(false);
  const [translationOfferBusy, setTranslationOfferBusy] = useState(false);
  const [pendingTranslationAction, setPendingTranslationAction] = useState<"draft" | "publish" | null>(null);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [aiTranslating, setAiTranslating] = useState(false);
  const [seoOptimizing, setSeoOptimizing] = useState(false);
  const [seoOptimization, setSeoOptimization] = useState<ArticleSeoOptimization | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLang, setPreviewLang] = useState<Language>("it");
  const [previewAuthors, setPreviewAuthors] = useState<{ id: string; name: string | null; avatar_url: string | null }[]>([]);
  const [activeTab, setActiveTab] = useState<"en" | "it">("en");
  const [titleEn, setTitleEn] = useState("");
  const [titleIt, setTitleIt] = useState("");
  const [slug, setSlug] = useState("");
  const [slugIt, setSlugIt] = useState("");
  const [slugEn, setSlugEn] = useState("");
  /** true quando l'utente ha modificato lo slug a mano dal campo dedicato: blocca l'auto-generazione dal titolo. */
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [slugItManuallyEdited, setSlugItManuallyEdited] = useState(false);
  const [slugEnManuallyEdited, setSlugEnManuallyEdited] = useState(false);
  const [excerptEn, setExcerptEn] = useState("");
  const [excerptIt, setExcerptIt] = useState("");
  const [contentEn, setContentEn] = useState<object>({});
  const [contentIt, setContentIt] = useState<object>({});
  const [articleMapScenes, setArticleMapScenes] = useState(() => normalizeArticleMapScenes(null));
  const [coverImage, setCoverImage] = useState("");
  const [coverCropOpen, setCoverCropOpen] = useState(false);
  const [instagramStoryImageEn, setInstagramStoryImageEn] = useState("");
  const [instagramStoryImageIt, setInstagramStoryImageIt] = useState("");
  const [instagramStoryUseCoverEn, setInstagramStoryUseCoverEn] = useState(true);
  const [instagramStoryUseCoverIt, setInstagramStoryUseCoverIt] = useState(true);
  const [coverFocal, setCoverFocal] = useState<CoverFocal>({ ...DEFAULT_COVER_FOCAL });
  const [category, setCategory] = useState("Notes from the Boat");
  const [editorialType, setEditorialType] = useState<"" | EditorialArticleType>("");
  /** Stato ultimo persistito sul server (per etichette tipo "Applica modifiche"). */
  const [persistedArticleStatus, setPersistedArticleStatus] = useState<"draft" | "scheduled" | "published" | null>(null);
  /** `published_at` originale quando l'articolo è già pubblicato (per non sovrascriverlo su "Applica modifiche"). */
  const [initialPublishedAt, setInitialPublishedAt] = useState<string | null>(null);
  /** Data programmata lato server (solo informativa: la modifica avviene dal Piano editoriale). */
  const [serverScheduledAt, setServerScheduledAt] = useState<string | null>(null);
  const [publishChoiceOpen, setPublishChoiceOpen] = useState(false);
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
  const geoWaypointClickHandlerRef = useRef<((event: maplibregl.MapLayerMouseEvent) => void) | null>(null);
  const geoWaypointMouseEnterRef = useRef<(() => void) | null>(null);
  const geoWaypointMouseLeaveRef = useRef<(() => void) | null>(null);
  const fittedVoyageIdRef = useRef<string | null>(null);
  const hydratedDraftRef = useRef(false);
  const skipNextDraftSaveRef = useRef(true);
  const hasLocalChangesRef = useRef(false);
  /** Specchio in stato del ref: serve ad abilitare/disabilitare i pulsanti di salvataggio. */
  const [hasLocalChanges, setHasLocalChanges] = useState(false);
  const markLocalChanges = useCallback((next: boolean) => {
    hasLocalChangesRef.current = next;
    setHasLocalChanges(next);
  }, []);
  const pendingNavigationRef = useRef<{ type: "path"; to: string } | { type: "back" } | null>(null);
  const pendingTranslationSaveRef = useRef<{ action: "draft" | "publish"; leaveTarget?: string } | null>(null);
  const leaveDialogOpenRef = useRef(false);
  const reopenLeaveAfterTranslationCancelRef = useRef(false);
  const ignoreNextPopRef = useRef(false);
  const draftStorageKey = `${ARTICLE_DRAFT_STORAGE_PREFIX}:${id ?? "new"}`;

  useEffect(() => {
    setPreviewLang(activeTab);
  }, [activeTab]);

  useEffect(() => {
    setPersistedArticleStatus(null);
    setInitialPublishedAt(null);
    setServerScheduledAt(null);
    setPublishChoiceOpen(false);
  }, [id]);

  useEffect(() => {
    hydratedDraftRef.current = false;
    skipNextDraftSaveRef.current = true;
    markLocalChanges(false);
  }, [draftStorageKey, markLocalChanges]);

  useEffect(() => {
    leaveDialogOpenRef.current = leaveDialogOpen;
  }, [leaveDialogOpen]);

  const loginPath = useCallback(
    () => navigate("/login", { state: { from: `/admin/article/${id}` } }),
    [navigate, id]
  );

  const applyDraft = useCallback((draft: ArticleEditorDraft) => {
    setTitleEn(draft.titleEn || "");
    setTitleIt(draft.titleIt || "");
    setSlug(draft.slug || "");
    setSlugIt(draft.slugIt || "");
    setSlugEn(draft.slugEn || "");
    setSlugManuallyEdited(Boolean(draft.slugManuallyEdited));
    setSlugItManuallyEdited(Boolean(draft.slugItManuallyEdited));
    setSlugEnManuallyEdited(Boolean(draft.slugEnManuallyEdited));
    setExcerptEn(draft.excerptEn || "");
    setExcerptIt(draft.excerptIt || "");
    setContentEn(draft.contentEn || {});
    setContentIt(draft.contentIt || {});
    setArticleMapScenes(normalizeArticleMapScenes(draft.articleMapScenes));
    setCoverImage(draft.coverImage || "");
    setInstagramStoryImageEn(draft.instagramStoryImageEn || "");
    setInstagramStoryImageIt(draft.instagramStoryImageIt || "");
    setInstagramStoryUseCoverEn(draft.instagramStoryUseCoverEn ?? true);
    setInstagramStoryUseCoverIt(draft.instagramStoryUseCoverIt ?? true);
    setCoverFocal(
      clampCoverFocal(
        Number(draft.coverFocal?.focalX ?? DEFAULT_COVER_FOCAL.focalX),
        Number(draft.coverFocal?.focalY ?? DEFAULT_COVER_FOCAL.focalY),
        Number(draft.coverFocal?.zoom ?? DEFAULT_COVER_FOCAL.zoom)
      )
    );
    setCategory(draft.category || "Notes from the Boat");
    setEditorialType(draft.editorialType === undefined ? "" : draft.editorialType || "");
    setAuthorIds(Array.isArray(draft.authorIds) ? draft.authorIds : []);
    setSelectedTagIds(Array.isArray(draft.selectedTagIds) ? draft.selectedTagIds : []);
    setSelectedStoryId(draft.selectedStoryId || null);
    setLatitude(typeof draft.latitude === "number" ? draft.latitude : null);
    setLongitude(typeof draft.longitude === "number" ? draft.longitude : null);
    setLocationName(draft.locationName || "");
    setSelectedVoyageId(draft.selectedVoyageId || null);
    setVoyageSegStart(typeof draft.voyageSegStart === "number" ? draft.voyageSegStart : null);
    setVoyageSegEnd(typeof draft.voyageSegEnd === "number" ? draft.voyageSegEnd : null);
    setAssociationMode(
      inferAssociationMode(
        draft.selectedVoyageId || null,
        typeof draft.voyageSegStart === "number" ? draft.voyageSegStart : null,
        typeof draft.voyageSegEnd === "number" ? draft.voyageSegEnd : null,
        typeof draft.latitude === "number" ? draft.latitude : null,
        typeof draft.longitude === "number" ? draft.longitude : null
      )
    );
  }, []);

  const restoreDraftFromStorage = useCallback(() => {
    if (hydratedDraftRef.current) return;

    const rawDraft = window.localStorage.getItem(draftStorageKey);
    hydratedDraftRef.current = true;
    if (!rawDraft) {
      // Nessuna bozza da riapplicare: non resta nessun render di assestamento
      // da ignorare, quindi la prossima modifica è già dell'utente.
      skipNextDraftSaveRef.current = false;
      return;
    }

    try {
      applyDraft(JSON.parse(rawDraft) as ArticleEditorDraft);
      markLocalChanges(true);
      toast.message(lang === "it" ? "Bozza locale ripristinata." : "Local draft restored.");
    } catch (error) {
      console.error("Failed to restore local article draft", error);
      window.localStorage.removeItem(draftStorageKey);
      skipNextDraftSaveRef.current = false;
    }
  }, [applyDraft, draftStorageKey, lang, markLocalChanges]);

  const loadSeoOptimization = useCallback(async (articleId?: string | null) => {
    if (!articleId || articleId === "new") {
      setSeoOptimization(null);
      return;
    }

    const { data, error } = await supabase
      .from("article_seo_optimizations")
      .select("*")
      .eq("article_id", articleId)
      .maybeSingle();

    if (error) {
      console.error("SEO optimization load failed:", error);
      setSeoOptimization(null);
      return;
    }

    setSeoOptimization((data as ArticleSeoOptimization | null) ?? null);
  }, []);

  const loadArticle = useCallback(async (userId: string) => {
    const { data, error } = await supabase.from("logbook_articles").select("*").eq("id", id).single();
    if (error && isAuthFailureError(error)) {
      await supabase.auth.signOut();
      loginPath();
      return;
    }
    if (error || !data) {
      navigate("/admin/articles");
      return;
    }
    const rowStatus = data.status;
    if (rowStatus === "draft" || rowStatus === "scheduled" || rowStatus === "published") {
      setPersistedArticleStatus(rowStatus);
    } else {
      setPersistedArticleStatus(null);
    }
    setTitleEn(data.title_en || "");
    setTitleIt(data.title_it || "");
    setSlug(data.slug || "");
    setSlugIt(((data as any).slug_it as string | null) || "");
    setSlugEn(((data as any).slug_en as string | null) || "");
    // Dati appena caricati dal server: nessuna modifica manuale ancora in corso in questa sessione.
    setSlugManuallyEdited(false);
    setSlugItManuallyEdited(false);
    setSlugEnManuallyEdited(false);
    setExcerptEn(data.excerpt_en || "");
    setExcerptIt(data.excerpt_it || "");
    setContentEn(data.content_en as object || {});
    setContentIt(data.content_it as object || {});
    setArticleMapScenes(normalizeArticleMapScenes((data as any).article_map_scenes));
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
    setEditorialType(((data as { editorial_type?: EditorialArticleType | null }).editorial_type ?? "") as "" | EditorialArticleType);
    setInitialPublishedAt(data.published_at || null);
    setServerScheduledAt(data.status === "scheduled" && data.scheduled_at ? data.scheduled_at : null);
    setSelectedStoryId((data as any).story_id || null);
    setLatitude((data as any).latitude || null);
    setLongitude((data as any).longitude || null);
    setLocationName((data as any).location_name || "");
    setSelectedVoyageId((data as any).voyage_id || null);
    setVoyageSegStart((data as any).voyage_segment_start ?? null);
    setVoyageSegEnd((data as any).voyage_segment_end ?? null);
    setAssociationMode(
      inferAssociationMode(
        (data as any).voyage_id || null,
        (data as any).voyage_segment_start ?? null,
        (data as any).voyage_segment_end ?? null,
        (data as any).latitude || null,
        (data as any).longitude || null
      )
    );

    // Load waypoints if voyage selected
    if ((data as any).voyage_id) {
      const { data: wps } = await supabase.from("voyage_waypoints").select("*").eq("voyage_id", (data as any).voyage_id).order("sort_order", { ascending: true });
      const list = (wps || []) as unknown as VoyageWaypoint[];
      setVoyageWaypoints(list);
      const resolved = resolveArticleRouteRange(
        {
          voyage_segment_start: (data as any).voyage_segment_start,
          voyage_segment_end: (data as any).voyage_segment_end,
          voyage_waypoint_start_id: (data as any).voyage_waypoint_start_id,
          voyage_waypoint_end_id: (data as any).voyage_waypoint_end_id,
        },
        list
      );
      if (resolved) {
        setVoyageSegStart(resolved[0]);
        setVoyageSegEnd(resolved[1]);
      }
    }

    // Load authors and tags
    const [authorsRes, tagsRes] = await Promise.all([
      supabase.from("article_authors").select("profile_id").eq("article_id", id),
      supabase.from("article_tags").select("tag_id").eq("article_id", id),
    ]);
    if (authorsRes.data?.length) setAuthorIds(authorsRes.data.map((a) => a.profile_id));
    else setAuthorIds([userId]);
    if (tagsRes.data?.length) setSelectedTagIds(tagsRes.data.map((t) => t.tag_id));

    await loadSeoOptimization(id);
    restoreDraftFromStorage();
  }, [id, navigate, loginPath, loadSeoOptimization, restoreDraftFromStorage]);

  const init = useCallback(async () => {
    const { session } = await validateSessionOrSignOut();
    if (!session) {
      loginPath();
      return;
    }

    const { data: isAdmin, error: adminError } = await supabase.rpc("has_role", {
      _user_id: session.user.id,
      _role: "admin",
    });
    if (adminError) {
      console.error("Admin check failed", adminError);
      loginPath();
      return;
    }
    if (!isAdmin) {
      toast.error(lang === "it" ? "Accesso non autorizzato" : "Access denied");
      navigate("/", { replace: true });
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
      setInitialPublishedAt(null);
      setServerScheduledAt(null);
      setSeoOptimization(null);
      restoreDraftFromStorage();
    } else {
      loadArticle(session.user.id);
    }
  }, [loginPath, navigate, lang, isNew, restoreDraftFromStorage, loadArticle]);

  useEffect(() => {
    init();
  }, [init]);

  const selectPointWaypoint = useCallback((index: number | null) => {
    if (index == null) {
      setVoyageSegStart(null);
      setVoyageSegEnd(null);
      return;
    }

    setVoyageSegStart(index);
    setVoyageSegEnd(index);
  }, []);

  const selectSegmentWaypoint = useCallback((index: number) => {
    if (voyageSegStart == null || voyageSegEnd != null) {
      setVoyageSegStart(index);
      setVoyageSegEnd(null);
      return;
    }

    if (index <= voyageSegStart) {
      setVoyageSegStart(index);
      setVoyageSegEnd(null);
      return;
    }

    setVoyageSegEnd(index);
  }, [voyageSegEnd, voyageSegStart]);

  const handleAssociationModeChange = useCallback((nextMode: "point" | "segment" | "full") => {
    setAssociationMode(nextMode);

    if (nextMode === "full") {
      setVoyageSegStart(null);
      setVoyageSegEnd(null);
      return;
    }

    if (nextMode === "point") {
      const selectedIndex = voyageSegStart ?? voyageSegEnd;
      if (selectedIndex == null) {
        setVoyageSegStart(null);
        setVoyageSegEnd(null);
        return;
      }

      setVoyageSegStart(selectedIndex);
      setVoyageSegEnd(selectedIndex);
      return;
    }

    if (voyageSegStart != null && voyageSegEnd != null && voyageSegStart === voyageSegEnd) {
      setVoyageSegEnd(null);
    }
  }, [voyageSegEnd, voyageSegStart]);

  const handleVoyageWaypointMapSelect = useCallback((index: number) => {
    if (associationMode === "full") return;
    if (associationMode === "point") {
      selectPointWaypoint(index);
      return;
    }

    selectSegmentWaypoint(index);
  }, [associationMode, selectPointWaypoint, selectSegmentWaypoint]);

  const handleSegmentStartChange = useCallback((value: string) => {
    if (!value) {
      setVoyageSegStart(null);
      setVoyageSegEnd(null);
      return;
    }

    const nextStart = Number(value);
    if (!Number.isFinite(nextStart)) return;

    setVoyageSegStart(nextStart);
    setVoyageSegEnd((currentEnd) => currentEnd != null && currentEnd > nextStart ? currentEnd : null);
  }, []);

  const handleSegmentEndChange = useCallback((value: string) => {
    if (!value) {
      setVoyageSegEnd(null);
      return;
    }

    const nextEnd = Number(value);
    if (!Number.isFinite(nextEnd)) return;

    if (voyageSegStart == null) {
      setVoyageSegStart(nextEnd);
      setVoyageSegEnd(null);
      return;
    }

    if (nextEnd <= voyageSegStart) {
      setVoyageSegEnd(null);
      return;
    }

    setVoyageSegEnd(nextEnd);
  }, [voyageSegStart]);

  useEffect(() => {
    if (!hydratedDraftRef.current) return;
    if (skipNextDraftSaveRef.current) {
      skipNextDraftSaveRef.current = false;
      return;
    }

    const draft: ArticleEditorDraft = {
      titleEn,
      titleIt,
      slug,
      slugIt,
      slugEn,
      slugManuallyEdited,
      slugItManuallyEdited,
      slugEnManuallyEdited,
      excerptEn,
      excerptIt,
      contentEn: contentEn as object,
      contentIt: contentIt as object,
      articleMapScenes,
      coverImage,
      instagramStoryImageEn,
      instagramStoryImageIt,
      instagramStoryUseCoverEn,
      instagramStoryUseCoverIt,
      coverFocal,
      category,
      editorialType,
      authorIds,
      selectedTagIds,
      selectedStoryId,
      latitude,
      longitude,
      locationName,
      selectedVoyageId,
      voyageSegStart,
      voyageSegEnd,
    };

    window.localStorage.setItem(draftStorageKey, JSON.stringify(draft));
    markLocalChanges(true);
  }, [
    markLocalChanges,
    articleMapScenes,
    authorIds,
    category,
    editorialType,
    contentEn,
    contentIt,
    coverFocal,
    coverImage,
    draftStorageKey,
    excerptEn,
    excerptIt,
    instagramStoryImageEn,
    instagramStoryImageIt,
    instagramStoryUseCoverEn,
    instagramStoryUseCoverIt,
    latitude,
    locationName,
    longitude,
    selectedStoryId,
    selectedTagIds,
    selectedVoyageId,
    slug,
    slugIt,
    slugEn,
    slugManuallyEdited,
    slugItManuallyEdited,
    slugEnManuallyEdited,
    titleEn,
    titleIt,
    voyageSegEnd,
    voyageSegStart,
  ]);

  useBeforeUnloadPrompt(hasLocalChanges && !saving && !leaveBusy);

  const generateSlug = (title: string) =>
    title
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);

  const handleTitleEnChange = (val: string) => {
    setTitleEn(val);
    // Auto-genera lo slug dal titolo finché l'utente non lo ha modificato a mano nel campo dedicato.
    if (!slugManuallyEdited && (isNew || !slug)) setSlug(generateSlug(val));
    if (!slugEnManuallyEdited && (isNew || !slugEn)) setSlugEn(generateSlug(val));
  };

  const handleTitleItChange = (val: string) => {
    setTitleIt(val);
    if (!slugItManuallyEdited && (isNew || !slugIt)) setSlugIt(generateSlug(val));
    // Canonico segue l'IT solo se manca un titolo EN da cui derivarlo e lo slug non è stato modificato a mano.
    if (!slugManuallyEdited && (isNew || !slug) && !titleEn.trim()) setSlug(generateSlug(val));
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
    const publicUrl = await uploadArticleImage(
      file,
      "covers",
      lang === "it" ? "Upload copertina non riuscito." : "Cover upload failed."
    );
    if (!publicUrl) return;
    setCoverImage(publicUrl);
    setCoverFocal({ ...DEFAULT_COVER_FOCAL });
    setCoverCropOpen(true);
  };

  const handleCoverCropConfirm = async (nextCoverFocal: CoverFocal) => {
    setCoverFocal(nextCoverFocal);
    setCoverCropOpen(false);
  };

  const handleInstagramStoryUpload = async (language: ArticleLanguage, file: File) => {
    const publicUrl = await uploadArticleImage(
      file,
      `instagram-stories/${language}`,
      lang === "it" ? "Upload immagine Instagram Stories non riuscito." : "Instagram Stories image upload failed."
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
      toast.message(
        lang === "it" ? "Inserisci un tag valido (lettere e numeri)." : "Enter a valid tag (letters and numbers)."
      );
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
      toast.error(
        lang === "it"
          ? "Impossibile aggiungere il tag. Controlla di essere autenticato."
          : "Could not add the tag. Check that you are signed in."
      );
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

  type EditorialSnapshot = {
    titleEn: string;
    titleIt: string;
    excerptEn: string;
    excerptIt: string;
    contentEn: object;
    contentIt: object;
  };

  const runArticleAiTranslation = useCallback(async (): Promise<
    { ok: false } | { ok: true; editorialSnapshot?: EditorialSnapshot }
  > => {
    setAiTranslating(true);
    try {
      const result = await invokeTranslateEditorContent({
        kind: "article",
        title_en: titleEn,
        title_it: titleIt,
        excerpt_en: excerptEn,
        excerpt_it: excerptIt,
        content_en: contentEn,
        content_it: contentIt,
      });
      if (!result.ok) {
        toast.error("error" in result ? result.error : lang === "it" ? "Errore di traduzione" : "Translation error");
        return { ok: false };
      }
      if (result.skipped) {
        toast.message(
          lang === "it"
            ? "Niente da tradurre: compila titolo, estratto o corpo in una lingua e lascia vuoti i campi nell’altra."
            : "Nothing to translate: fill in title, excerpt or body in one language and leave the other language's fields empty."
        );
        return { ok: true };
      }
      const f = result.fields;
      const next: EditorialSnapshot = {
        titleEn: typeof f.title_en === "string" ? f.title_en : titleEn,
        titleIt: typeof f.title_it === "string" ? f.title_it : titleIt,
        excerptEn: typeof f.excerpt_en === "string" ? f.excerpt_en : excerptEn,
        excerptIt: typeof f.excerpt_it === "string" ? f.excerpt_it : excerptIt,
        contentEn: f.content_en && typeof f.content_en === "object" ? (f.content_en as object) : contentEn,
        contentIt: f.content_it && typeof f.content_it === "object" ? (f.content_it as object) : contentIt,
      };
      setTitleEn(next.titleEn);
      setTitleIt(next.titleIt);
      setExcerptEn(next.excerptEn);
      setExcerptIt(next.excerptIt);
      setContentEn(next.contentEn);
      setContentIt(next.contentIt);
      toast.success(lang === "it" ? "Traduzione applicata." : "Translation applied.");
      return { ok: true, editorialSnapshot: next };
    } finally {
      setAiTranslating(false);
    }
  }, [titleEn, titleIt, excerptEn, excerptIt, contentEn, contentIt, lang]);

  const handleAiTranslateMissing = useCallback(() => {
    void runArticleAiTranslation();
  }, [runArticleAiTranslation]);

  const runSeoOptimization = useCallback(async (
    articleId?: string | null,
    options?: { accessToken?: string; background?: boolean; force?: boolean; quiet?: boolean }
  ): Promise<boolean> => {
    const targetId = articleId && articleId !== "new" ? articleId : id;
    if (!targetId || targetId === "new") {
      if (!options?.quiet) {
        toast.error(lang === "it" ? "Salva l'articolo prima di generare la SEO." : "Save the article before generating SEO.");
      }
      return false;
    }

    const showBusyState = !options?.background;
    if (showBusyState) setSeoOptimizing(true);
    try {
      let data: unknown = null;
      if (options?.background) {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
        const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
        const accessToken = options.accessToken || (await supabase.auth.getSession()).data.session?.access_token;
        if (!supabaseUrl || !publishableKey || !accessToken) throw new Error("Supabase session missing");

        const response = await fetch(`${supabaseUrl}/functions/v1/optimize-article-seo`, {
          method: "POST",
          keepalive: true,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            apikey: publishableKey,
          },
          body: JSON.stringify({ articleId: targetId, force: options.force === true }),
        });
        data = await response.json().catch(() => null);
        if (!response.ok) {
          const message = data && typeof data === "object" && "error" in data ? String((data as { error?: unknown }).error) : "SEO optimization failed";
          throw new Error(message);
        }
      } else {
        const { data: invokeData, error } = await supabase.functions.invoke("optimize-article-seo", {
          body: { articleId: targetId, force: options?.force === true },
        });

        if (error) throw error;
        data = invokeData;
      }

      const payload = data as { error?: string; skipped?: string } | null;
      if (payload?.error) throw new Error(payload.error);
      if (payload?.skipped === "not_published") {
        if (!options?.quiet) {
          toast.info(
            lang === "it"
              ? "La SEO automatica si genera solo sugli articoli pubblicati."
              : "Automatic SEO is generated only for published articles."
          );
        }
        return false;
      }
      if (payload?.skipped === "unchanged") {
        await loadSeoOptimization(targetId);
        if (!options?.quiet) {
          toast.info(lang === "it" ? "SEO già aggiornata: nessuna modifica da rigenerare." : "SEO already up to date: nothing to regenerate.");
        }
        return true;
      }

      await loadSeoOptimization(targetId);
      if (!options?.quiet) toast.success(lang === "it" ? "Ottimizzazione SEO generata." : "SEO optimization generated.");
      return true;
    } catch (error) {
      console.error("SEO optimization failed:", error);
      if (!options?.quiet) toast.error(lang === "it" ? "Ottimizzazione SEO non riuscita." : "SEO optimization failed.");
      return false;
    } finally {
      if (showBusyState) setSeoOptimizing(false);
    }
  }, [id, loadSeoOptimization, lang]);

  const saveArticle = useCallback(async (
    action: "draft" | "publish",
    options?: {
      leaveTarget?: string;
      bypassTranslationPrompt?: boolean;
      /** Valori editoriali appena tradotti (lo stato React può non essere ancora aggiornato). */
      editorialSnapshot?: EditorialSnapshot;
    }
  ): Promise<boolean> => {
    const leaveTarget = options?.leaveTarget;
    const bypassTranslationPrompt = options?.bypassTranslationPrompt === true;
    const snap = options?.editorialSnapshot;

    const { session: live } = await validateSessionOrSignOut();
    if (!live) {
      toast.error(lang === "it" ? "Sessione non valida. Effettua di nuovo l’accesso." : "Invalid session. Please sign in again.");
      navigate("/login", { state: { from: `/admin/article/${id}` } });
      return false;
    }
    let finalStatus: "draft" | "scheduled" | "published";
    let publishedAt: string | null = null;
    let scheduledAt: string | null = null;
    const wasPublished = persistedArticleStatus === "published";
    const trimmedSlug = slug.trim();

    if (!trimmedSlug) {
      toast.error(
        lang === "it"
          ? "Inserisci almeno un titolo inglese o uno slug prima di salvare."
          : "Enter at least an English title or a slug before saving."
      );
      return false;
    }

    let normalizedVoyageSegStart: number | null = null;
    let normalizedVoyageSegEnd: number | null = null;
    if (selectedVoyageId) {
      if (associationMode === "point") {
        const selectedIndex = voyageSegStart ?? voyageSegEnd;
        if (selectedIndex == null) {
          toast.error(
            lang === "it"
              ? "Seleziona un waypoint della rotta per associare l'articolo a un punto."
              : "Select a route waypoint to associate the article with a point."
          );
          return false;
        }
        normalizedVoyageSegStart = selectedIndex;
        normalizedVoyageSegEnd = selectedIndex;
      } else if (associationMode === "segment") {
        if (voyageSegStart == null || voyageSegEnd == null || voyageSegEnd <= voyageSegStart) {
          toast.error(
            lang === "it"
              ? "Seleziona due waypoint della rotta per definire il segmento."
              : "Select two route waypoints to define the segment."
          );
          return false;
        }
        normalizedVoyageSegStart = Math.min(voyageSegStart, voyageSegEnd);
        normalizedVoyageSegEnd = Math.max(voyageSegStart, voyageSegEnd);
      }
    }

    let voyage_waypoint_start_id: string | null = null;
    let voyage_waypoint_end_id: string | null = null;
    if (!selectedVoyageId) {
      voyage_waypoint_start_id = null;
      voyage_waypoint_end_id = null;
    } else if (associationMode === "full" || !voyageWaypoints.length) {
      voyage_waypoint_start_id = null;
      voyage_waypoint_end_id = null;
    } else if (associationMode === "point" && normalizedVoyageSegStart != null) {
      const wp = voyageWaypoints[normalizedVoyageSegStart];
      if (wp?.id) {
        voyage_waypoint_start_id = wp.id;
        voyage_waypoint_end_id = wp.id;
      }
    } else if (
      associationMode === "segment" &&
      normalizedVoyageSegStart != null &&
      normalizedVoyageSegEnd != null
    ) {
      const ws = voyageWaypoints[normalizedVoyageSegStart];
      const we = voyageWaypoints[normalizedVoyageSegEnd];
      if (ws?.id) voyage_waypoint_start_id = ws.id;
      if (we?.id) voyage_waypoint_end_id = we.id;
    }

    if (!bypassTranslationPrompt) {
      const gaps = getArticleTranslationGaps({
        titleEn: titleEn,
        titleIt: titleIt,
        excerptEn: excerptEn,
        excerptIt: excerptIt,
        contentEn: contentEn,
        contentIt: contentIt,
      });
      if (gaps.hasGaps) {
        pendingTranslationSaveRef.current = { action, leaveTarget };
        setPendingTranslationAction(action);
        if (leaveDialogOpenRef.current) {
          reopenLeaveAfterTranslationCancelRef.current = true;
          setLeaveDialogOpen(false);
        }
        setTranslationOfferOpen(true);
        return false;
      }
    }

    setSaving(true);

    const saveTitleEn = snap?.titleEn ?? titleEn;
    const saveTitleIt = snap?.titleIt ?? titleIt;
    const saveExcerptEn = snap?.excerptEn ?? excerptEn;
    const saveExcerptIt = snap?.excerptIt ?? excerptIt;
    const saveContentEn = snap?.contentEn ?? contentEn;
    const saveContentIt = snap?.contentIt ?? contentIt;

    if (action === "draft") {
      if (wasPublished) {
        // Un articolo già online resta online: la modifica va in produzione
        // in silenzio, senza retrocederlo a bozza né spostarne la data di uscita.
        finalStatus = "published";
        scheduledAt = null;
        publishedAt = initialPublishedAt ?? new Date().toISOString();
      } else if (persistedArticleStatus === "scheduled" && serverScheduledAt) {
        // Preserve scheduling when editing an already-scheduled article:
        // the editorial plan slot is still linked, so don't tear it down.
        finalStatus = "scheduled";
        scheduledAt = serverScheduledAt;
      } else {
        finalStatus = "draft";
        scheduledAt = null;
      }
    } else {
      finalStatus = "published";
      scheduledAt = null;
      publishedAt = wasPublished && initialPublishedAt ? initialPublishedAt : new Date().toISOString();
    }

    if (action === "publish" && articleMapScenes.length > 0) {
      const incompleteScenes = articleMapScenes.filter((scene) => {
        const hasEnAnchor = Boolean(scene.anchor_id_en?.trim());
        const hasItAnchor = Boolean(scene.anchor_id_it?.trim());
        return !hasEnAnchor || !hasItAnchor;
      });

      if (incompleteScenes.length > 0) {
        const warningLines = incompleteScenes.map((scene, index) => {
          const sceneLabel = scene.title_en || scene.title_it || `Scene ${index + 1}`;
          const hasEnAnchor = Boolean(scene.anchor_id_en?.trim());
          const hasItAnchor = Boolean(scene.anchor_id_it?.trim());

          if (!hasEnAnchor && !hasItAnchor) return `- ${sceneLabel}: non agganciata in EN e IT`;
          if (!hasEnAnchor) return `- ${sceneLabel}: manca aggancio EN`;
          return `- ${sceneLabel}: manca aggancio IT`;
        });

        const sceneMapConfirmLead =
          wasPublished
            ? "Ci sono scene mappa non ancora agganciate correttamente. Vuoi applicare comunque le modifiche?"
            : "Ci sono scene mappa non ancora agganciate correttamente. Vuoi pubblicare comunque l'articolo?";
        const shouldContinue = window.confirm([sceneMapConfirmLead, "", ...warningLines].join("\n"));

        if (!shouldContinue) {
          setSaving(false);
          return false;
        }
      }
    }

    const articleData = {
      title_en: saveTitleEn,
      title_it: saveTitleIt,
      slug: trimmedSlug,
      slug_it: (slugIt || "").trim() || null,
      slug_en: (slugEn || "").trim() || null,
      excerpt_en: saveExcerptEn,
      excerpt_it: saveExcerptIt,
      content_en: saveContentEn as Json,
      content_it: saveContentIt as Json,
      article_map_scenes: articleMapScenes as unknown as Json,
      cover_image: coverImage,
      instagram_story_image_en: instagramStoryImageEn || null,
      instagram_story_image_it: instagramStoryImageIt || null,
      instagram_story_use_cover_en: instagramStoryUseCoverEn,
      instagram_story_use_cover_it: instagramStoryUseCoverIt,
      category,
      editorial_type: editorialType === "" ? null : editorialType,
      status: finalStatus,
      published_at: publishedAt,
      scheduled_at: scheduledAt,
      story_id: selectedStoryId || null,
      latitude,
      longitude,
      location_name: locationName || null,
      voyage_id: selectedVoyageId || null,
      voyage_segment_start: normalizedVoyageSegStart,
      voyage_segment_end: normalizedVoyageSegEnd,
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
        } else toast.error(getSaveErrorMessage(error, lang));
        setSaving(false);
        return false;
      }
      if (data) {
        articleId = data.id;
        const stayForPublishedView = action === "publish" && finalStatus === "published";
        if (!stayForPublishedView && !leaveTarget) {
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
        } else toast.error(getSaveErrorMessage(upErr, lang));
        setSaving(false);
        return false;
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
        toast.error(lang === "it" ? "Salvataggio autori o tag non riuscito." : "Failed to save authors or tags.");
        setSaving(false);
        return false;
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
        toast.error(lang === "it" ? "Salvataggio autori o tag non riuscito." : "Failed to save authors or tags.");
        setSaving(false);
        return false;
      }

      // Notifiche solo alla prima messa online: modificare un articolo già
      // pubblicato non deve rispedire nulla agli iscritti.
      const isFirstPublication = finalStatus === "published" && !wasPublished;

      // Send email notifications to story subscribers when publishing a new chapter
      if (isFirstPublication && selectedStoryId && articleId) {
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
                chapterTitle: saveTitleEn,
                chapterUrl: `${origin}/logbook/${slug}`,
                storyUrl: `${origin}/logbook/story/${story?.slug || ""}`,
              },
            });
          }
        } catch (e) {
          console.error("Failed to send story notifications:", e);
        }
      }

      if (finalStatus === "published" && articleId) {
        void runSeoOptimization(articleId, { accessToken: live.access_token, background: true, quiet: true });
        void supabase.functions.invoke("sync-article-community-post", {
          body: { articleId },
        }).then(({ error }) => {
          if (error) console.error("Failed to sync community post:", error);
        });

        if (isFirstPublication) {
          try {
            await supabase.functions.invoke("notify-article-publication", {
              body: {
                articleId,
              },
            });
          } catch (e) {
            console.error("Failed to create publication notifications:", e);
          }
        }
      }
    }

    window.localStorage.removeItem(draftStorageKey);
    markLocalChanges(false);
    setPersistedArticleStatus(finalStatus);
    // La programmazione sopravvive al salvataggio: azzerarla qui farebbe
    // retrocedere a bozza il salvataggio successivo della stessa sessione.
    setServerScheduledAt(finalStatus === "scheduled" ? scheduledAt : null);
    if (publishedAt) setInitialPublishedAt(publishedAt);

    if (action === "draft") {
      if (finalStatus === "published") {
        toast.success(lang === "it" ? "Modifiche pubblicate." : "Changes are live.");
      } else if (finalStatus === "scheduled") {
        toast.success(lang === "it" ? "Modifiche salvate, programmazione invariata." : "Changes saved, schedule unchanged.");
      } else {
        toast.success(lang === "it" ? "Bozza salvata." : "Draft saved.");
      }
    }

    if (action === "publish" && finalStatus === "published" && articleId && articleId !== "new" && slug?.trim()) {
      window.location.assign(`${window.location.origin}/logbook/${encodeURIComponent(slug.trim())}`);
      return true;
    }

    if (leaveTarget) {
      navigate(leaveTarget, { replace: true });
      setSaving(false);
      return true;
    }

    setSaving(false);
    return true;
  }, [
    titleEn,
    titleIt,
    slug,
    slugIt,
    slugEn,
    excerptEn,
    excerptIt,
    contentEn,
    contentIt,
    articleMapScenes,
    coverImage,
    instagramStoryImageEn,
    instagramStoryImageIt,
    instagramStoryUseCoverEn,
    instagramStoryUseCoverIt,
    coverFocal,
    category,
    editorialType,
    authorIds,
    selectedTagIds,
    selectedStoryId,
    latitude,
    longitude,
    locationName,
    selectedVoyageId,
    associationMode,
    voyageSegStart,
    voyageSegEnd,
    voyageWaypoints,
    id,
    isNew,
    navigate,
    allStories,
    draftStorageKey,
    persistedArticleStatus,
    initialPublishedAt,
    runSeoOptimization,
    lang,
    markLocalChanges,
    serverScheduledAt,
  ]);

  const translationOfferLabels = useMemo(() => {
    if (!translationOfferOpen) return [] as string[];
    return getArticleTranslationGaps({
      titleEn,
      titleIt,
      excerptEn,
      excerptIt,
      contentEn,
      contentIt,
    }).labels;
  }, [translationOfferOpen, titleEn, titleIt, excerptEn, excerptIt, contentEn, contentIt]);

  const handleTranslationOfferClose = useCallback(() => {
    setTranslationOfferOpen(false);
    setPendingTranslationAction(null);
    pendingTranslationSaveRef.current = null;
    if (reopenLeaveAfterTranslationCancelRef.current) {
      reopenLeaveAfterTranslationCancelRef.current = false;
      setLeaveDialogOpen(true);
    }
  }, []);

  const handleTranslationOfferTranslateAndContinue = useCallback(async () => {
    const pending = pendingTranslationSaveRef.current;
    if (!pending) return;
    setTranslationOfferBusy(true);
    try {
      const tr = await runArticleAiTranslation();
      if (!tr.ok) return;
      pendingTranslationSaveRef.current = null;
      setTranslationOfferOpen(false);
      setPendingTranslationAction(null);
      reopenLeaveAfterTranslationCancelRef.current = false;
      const saved = await saveArticle(pending.action, {
        leaveTarget: pending.leaveTarget,
        bypassTranslationPrompt: true,
        editorialSnapshot: tr.editorialSnapshot,
      });
      if (!saved && pending.leaveTarget) {
        pendingNavigationRef.current = { type: "path", to: pending.leaveTarget };
        setLeaveDialogOpen(true);
      }
    } finally {
      setTranslationOfferBusy(false);
    }
  }, [runArticleAiTranslation, saveArticle]);

  const handleTranslationOfferSkip = useCallback(async () => {
    const pending = pendingTranslationSaveRef.current;
    if (!pending) return;
    setTranslationOfferBusy(true);
    try {
      pendingTranslationSaveRef.current = null;
      setTranslationOfferOpen(false);
      setPendingTranslationAction(null);
      reopenLeaveAfterTranslationCancelRef.current = false;
      const saved = await saveArticle(pending.action, {
        leaveTarget: pending.leaveTarget,
        bypassTranslationPrompt: true,
      });
      if (!saved && pending.leaveTarget) {
        pendingNavigationRef.current = { type: "path", to: pending.leaveTarget };
        setLeaveDialogOpen(true);
      }
    } finally {
      setTranslationOfferBusy(false);
    }
  }, [saveArticle]);

  const continuePendingNavigation = useCallback(() => {
    const pending = pendingNavigationRef.current;
    pendingNavigationRef.current = null;
    setLeaveDialogOpen(false);
    if (!pending) return;
    if (pending.type === "path") {
      navigate(pending.to);
      return;
    }
    ignoreNextPopRef.current = true;
    window.history.back();
  }, [navigate]);

  const requestLeave = useCallback(
    (to: string) => {
      if (!hasLocalChangesRef.current || saving || leaveBusy) {
        navigate(to);
        return;
      }
      pendingNavigationRef.current = { type: "path", to };
      setLeaveDialogOpen(true);
    },
    [leaveBusy, navigate, saving],
  );

  const handleStayOnLeaveDialog = () => {
    pendingNavigationRef.current = null;
    setLeaveDialogOpen(false);
  };

  const handleDiscardLeaveFromEditor = () => {
    window.localStorage.removeItem(draftStorageKey);
    markLocalChanges(false);
    continuePendingNavigation();
  };

  const handleLeaveSaveDraft = async () => {
    const pending = pendingNavigationRef.current;
    if (!pending) return;
    setLeaveBusy(true);
    try {
      if (pending.type === "path") {
        const ok = await saveArticle("draft", { leaveTarget: pending.to });
        if (!ok) return;
        pendingNavigationRef.current = null;
        setLeaveDialogOpen(false);
        return;
      }
      const ok = await saveArticle("draft");
      if (!ok) return;
      pendingNavigationRef.current = null;
      setLeaveDialogOpen(false);
      ignoreNextPopRef.current = true;
      window.history.back();
    } finally {
      setLeaveBusy(false);
    }
  };

  const handleLeavePublish = async () => {
    const pending = pendingNavigationRef.current;
    if (!pending) return;
    setLeaveBusy(true);
    try {
      if (pending.type === "path") {
        const ok = await saveArticle("publish", { leaveTarget: pending.to });
        if (!ok) return;
        pendingNavigationRef.current = null;
        setLeaveDialogOpen(false);
        return;
      }
      const ok = await saveArticle("publish");
      if (!ok) return;
      pendingNavigationRef.current = null;
      setLeaveDialogOpen(false);
      ignoreNextPopRef.current = true;
      window.history.back();
    } finally {
      setLeaveBusy(false);
    }
  };

  const handlePublishChoicePlanning = useCallback(async () => {
    const ok = await saveArticle("draft");
    if (!ok) return;
    setPublishChoiceOpen(false);
    try {
      window.sessionStorage.setItem(ADMIN_DASH_SECTION_STORAGE_KEY, "editorial");
    } catch {
      /* ignore */
    }
    toast.success(
      lang === "it"
        ? "Bozza salvata. Imposta data e slot dal Piano editoriale in dashboard."
        : "Draft saved. Set date and slot from the Editorial Plan in the dashboard."
    );
    navigate("/admin/articles");
  }, [navigate, saveArticle, lang]);

  const handlePublishChoicePublishNow = useCallback(() => {
    void (async () => {
      setPublishChoiceOpen(false);
      await saveArticle("publish");
    })();
  }, [saveArticle]);

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      if (!hasLocalChangesRef.current || saving || leaveBusy) return;
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const nextUrl = new URL(anchor.href, window.location.href);
      if (nextUrl.origin !== window.location.origin) return;

      const currentUrl = `${location.pathname}${location.search}${location.hash}`;
      const nextPath = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
      if (currentUrl === nextPath) return;

      event.preventDefault();
      pendingNavigationRef.current = { type: "path", to: nextPath };
      setLeaveDialogOpen(true);
    };

    document.addEventListener("click", handleDocumentClick, true);
    return () => document.removeEventListener("click", handleDocumentClick, true);
  }, [leaveBusy, location.hash, location.pathname, location.search, saving]);

  useEffect(() => {
    const currentUrl = `${location.pathname}${location.search}${location.hash}`;

    const handlePopState = () => {
      if (ignoreNextPopRef.current) {
        ignoreNextPopRef.current = false;
        return;
      }
      if (!hasLocalChangesRef.current || saving || leaveBusy) return;

      pendingNavigationRef.current = { type: "back" };
      setLeaveDialogOpen(true);
      window.history.pushState(null, "", currentUrl);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [leaveBusy, location.hash, location.pathname, location.search, saving]);

  // Geo map initialization
  useEffect(() => {
    if (!geoMapRef.current || geoMapInstanceRef.current) return;
    const map = new maplibregl.Map({
      container: geoMapRef.current,
      style: createCartoRasterStyle(),
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
      const clickedWaypointFeatures = map.queryRenderedFeatures(e.point, { layers: ["editor-waypoints"] });
      if (clickedWaypointFeatures.length) return;

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
    fittedVoyageIdRef.current = null;
    if (!selectedVoyageId) {
      setVoyageWaypoints([]);
      setVoyageSegStart(null);
      setVoyageSegEnd(null);
      return;
    }

    (async () => {
      const { data } = await supabase.from("voyage_waypoints").select("*").eq("voyage_id", selectedVoyageId).order("sort_order", { ascending: true });
      const nextWaypoints = (data || []) as unknown as VoyageWaypoint[];
      setVoyageWaypoints(nextWaypoints);
      setVoyageSegStart((current) => current != null && current < nextWaypoints.length ? current : null);
      setVoyageSegEnd((current) => current != null && current < nextWaypoints.length ? current : null);
    })();
  }, [selectedVoyageId]);

  const selectedVoyage = allVoyages.find((voyage) => voyage.id === selectedVoyageId) || null;
  useEffect(() => {
    if (!previewOpen || authorIds.length === 0) {
      setPreviewAuthors([]);
      return;
    }

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("public_profiles")
        .select("id, name, avatar_url")
        .in("id", authorIds);
      if (cancelled) return;
      if (error) {
        console.error("Failed to load preview authors:", error);
        setPreviewAuthors(authorIds.map((authorId) => ({ id: authorId, name: "Author", avatar_url: null })));
        return;
      }

      const profileMap = new Map((data || []).map((profile) => [profile.id, profile]));
      setPreviewAuthors(
        authorIds.map((authorId) => {
          const profile = profileMap.get(authorId);
          return {
            id: authorId,
            name: profile?.name ?? "Author",
            avatar_url: profile?.avatar_url ?? null,
          };
        })
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [authorIds, previewOpen]);

  const selectedVoyageCachedGeometry = useMemo(() => {
    const geometrySource = selectedVoyage?.cached_geometry as { coordinates?: [number, number][] } | null;
    return Array.isArray(geometrySource?.coordinates) ? geometrySource.coordinates : undefined;
  }, [selectedVoyage]);
  const selectedVoyageRouteCoordinates = useMemo(() => {
    if (!selectedVoyage || voyageWaypoints.length < 2) return [];
    return buildPublicVoyageGeometry(
      voyageWaypoints,
      selectedVoyage.type,
      [],
      selectedVoyage.id,
      selectedVoyageCachedGeometry
    );
  }, [selectedVoyage, selectedVoyageCachedGeometry, voyageWaypoints]);
  const selectedVoyageHighlightCoordinates = useMemo(() => {
    if (!selectedVoyage || voyageWaypoints.length < 2) return [];

    if (associationMode === "full") {
      return selectedVoyageRouteCoordinates;
    }

    if (associationMode === "segment" && voyageSegStart != null && voyageSegEnd != null) {
      return buildVoyageSegmentGeometry(
        voyageWaypoints,
        selectedVoyage.type,
        voyageSegStart,
        voyageSegEnd,
        selectedVoyageCachedGeometry
      );
    }

    return [];
  }, [
    associationMode,
    selectedVoyage,
    selectedVoyageCachedGeometry,
    selectedVoyageRouteCoordinates,
    voyageSegEnd,
    voyageSegStart,
    voyageWaypoints,
  ]);

  // Draw voyage route on geo map
  useEffect(() => {
    const map = geoMapInstanceRef.current;
    if (!map) return;

    const draw = () => {
      if (geoWaypointClickHandlerRef.current) {
        map.off("click", "editor-waypoints", geoWaypointClickHandlerRef.current);
        geoWaypointClickHandlerRef.current = null;
      }
      if (geoWaypointMouseEnterRef.current) {
        map.off("mouseenter", "editor-waypoints", geoWaypointMouseEnterRef.current);
        geoWaypointMouseEnterRef.current = null;
      }
      if (geoWaypointMouseLeaveRef.current) {
        map.off("mouseleave", "editor-waypoints", geoWaypointMouseLeaveRef.current);
        geoWaypointMouseLeaveRef.current = null;
      }

      [
        "editor-route-highlight",
        "editor-route",
        "editor-waypoints-selected",
        "editor-waypoints",
      ].forEach((layerId) => {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(layerId)) map.removeSource(layerId);
      });

      if (!selectedVoyageId || !voyageWaypoints.length) return;

      const routeCoordinates = selectedVoyageRouteCoordinates;
      const hasSpecificSelection =
        (associationMode === "point" && voyageSegStart != null) ||
        (associationMode === "segment" && voyageSegStart != null && voyageSegEnd != null);

      if (routeCoordinates.length >= 2) {
        map.addSource("editor-route", {
          type: "geojson",
          data: {
            type: "Feature",
            geometry: { type: "LineString", coordinates: routeCoordinates },
            properties: {},
          },
        });
        map.addLayer({
          id: "editor-route",
          type: "line",
          source: "editor-route",
          paint: {
            "line-color": "hsl(210,60%,45%)",
            "line-width": hasSpecificSelection ? 4 : 3,
            "line-opacity": hasSpecificSelection ? 0.72 : 0.42,
          },
        });
      }

      map.addSource("editor-waypoints", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: voyageWaypoints.map((waypoint, index) => ({
            type: "Feature" as const,
            geometry: {
              type: "Point" as const,
              coordinates: [waypoint.lng, waypoint.lat],
            },
            properties: {
              index,
              label: getWaypointOptionLabel(waypoint, index, voyageWaypoints.length),
              isTerminal: index === 0 || index === voyageWaypoints.length - 1,
            },
          })),
        },
      });
      map.addLayer({
        id: "editor-waypoints",
        type: "circle",
        source: "editor-waypoints",
        paint: {
          "circle-radius": ["case", ["boolean", ["get", "isTerminal"], false], 6, 4.5],
          "circle-color": ["case", ["boolean", ["get", "isTerminal"], false], "hsl(210,60%,45%)", "hsl(215,20%,58%)"],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff",
          "circle-opacity": 0.96,
        },
      });

      const selectedFeatures: GeoJSON.Feature<GeoJSON.Point>[] = [];
      if (associationMode === "point" && voyageSegStart != null && voyageWaypoints[voyageSegStart]) {
        selectedFeatures.push({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [voyageWaypoints[voyageSegStart].lng, voyageWaypoints[voyageSegStart].lat],
          },
          properties: {},
        });
      }

      if (associationMode === "segment" && voyageSegStart != null && voyageWaypoints[voyageSegStart]) {
        selectedFeatures.push({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [voyageWaypoints[voyageSegStart].lng, voyageWaypoints[voyageSegStart].lat],
          },
          properties: {},
        });
      }

      if (
        associationMode === "segment" &&
        voyageSegStart != null &&
        voyageSegEnd != null &&
        voyageWaypoints[voyageSegEnd]
      ) {
        selectedFeatures.push({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [voyageWaypoints[voyageSegEnd].lng, voyageWaypoints[voyageSegEnd].lat],
          },
          properties: {},
        });
      }

      if (associationMode === "full" && routeCoordinates.length >= 2) {
        map.addSource("editor-route-highlight", {
          type: "geojson",
          data: {
            type: "Feature",
            geometry: { type: "LineString", coordinates: routeCoordinates },
            properties: {},
          },
        });
        map.addLayer({
          id: "editor-route-highlight",
          type: "line",
          source: "editor-route-highlight",
          paint: { "line-color": "hsl(210,60%,45%)", "line-width": 5, "line-opacity": 0.82 },
        });
      }

      if (
        associationMode === "segment" &&
        voyageSegStart != null &&
        voyageSegEnd != null &&
        selectedVoyageHighlightCoordinates.length >= 2
      ) {
        map.addSource("editor-route-highlight", {
          type: "geojson",
          data: {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: selectedVoyageHighlightCoordinates,
            },
            properties: {},
          },
        });
        map.addLayer({
          id: "editor-route-highlight",
          type: "line",
          source: "editor-route-highlight",
          paint: { "line-color": "hsl(180,68%,34%)", "line-width": 5, "line-opacity": 0.9 },
        });
      }

      if (selectedFeatures.length) {
        map.addSource("editor-waypoints-selected", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: selectedFeatures,
          },
        });
        map.addLayer({
          id: "editor-waypoints-selected",
          type: "circle",
          source: "editor-waypoints-selected",
          paint: {
            "circle-radius": 7.5,
            "circle-color": "hsl(180,68%,34%)",
            "circle-stroke-width": 3,
            "circle-stroke-color": "#fff",
          },
        });
      }

      geoWaypointClickHandlerRef.current = (event: maplibregl.MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        const index = Number(feature?.properties?.index);
        if (!Number.isFinite(index)) return;
        handleVoyageWaypointMapSelect(index);
      };
      geoWaypointMouseEnterRef.current = () => {
        map.getCanvas().style.cursor = associationMode === "full" ? "" : "pointer";
      };
      geoWaypointMouseLeaveRef.current = () => {
        map.getCanvas().style.cursor = "";
      };

      map.on("click", "editor-waypoints", geoWaypointClickHandlerRef.current);
      map.on("mouseenter", "editor-waypoints", geoWaypointMouseEnterRef.current);
      map.on("mouseleave", "editor-waypoints", geoWaypointMouseLeaveRef.current);
    };

    if (map.isStyleLoaded()) draw();
    else map.on("load", draw);
  }, [associationMode, handleVoyageWaypointMapSelect, selectedVoyageHighlightCoordinates, selectedVoyageId, selectedVoyageRouteCoordinates, voyageSegEnd, voyageSegStart, voyageWaypoints]);

  useEffect(() => {
    const map = geoMapInstanceRef.current;
    if (!map || !selectedVoyageId || !voyageWaypoints.length) return;
    if (fittedVoyageIdRef.current === selectedVoyageId) return;

    const fit = () => {
      const coordinates = selectedVoyageRouteCoordinates;
      if (!coordinates.length) return;

      if (coordinates.length === 1) {
        map.flyTo({ center: coordinates[0], zoom: 9, duration: 500 });
      } else {
        const bounds = coordinates.reduce(
          (accumulator, coordinate) => accumulator.extend(coordinate),
          new maplibregl.LngLatBounds(coordinates[0], coordinates[0])
        );
        map.fitBounds(bounds, { padding: 42, duration: 500, maxZoom: 9.5 });
      }

      fittedVoyageIdRef.current = selectedVoyageId;
    };

    if (map.isStyleLoaded()) fit();
    else map.once("load", fit);
  }, [selectedVoyageId, selectedVoyageRouteCoordinates]);

  useEffect(() => {
    if (
      associationMode !== "point" ||
      !selectedVoyageId ||
      voyageSegStart != null ||
      voyageSegEnd != null ||
      latitude == null ||
      longitude == null ||
      !voyageWaypoints.length
    ) {
      return;
    }

    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    voyageWaypoints.forEach((waypoint, index) => {
      const distance = Math.hypot(waypoint.lat - latitude, waypoint.lng - longitude);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    setVoyageSegStart(nearestIndex);
    setVoyageSegEnd(nearestIndex);
  }, [associationMode, latitude, longitude, selectedVoyageId, voyageSegEnd, voyageSegStart, voyageWaypoints]);

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

  /** Un articolo online non si ripubblica: si aggiorna e basta. Il flusso di pubblicazione resta alle bozze. */
  const isPublishedArticle = persistedArticleStatus === "published";
  const primaryPublishActionLabel = "Pubblica";
  const saveActionLabel = useMemo(() => {
    if (isPublishedArticle) return "Aggiorna";
    if (persistedArticleStatus) return "Aggiorna bozza";
    return "Crea bozza";
  }, [isPublishedArticle, persistedArticleStatus]);
  const leaveSaveActionLabel = useMemo(
    () => (isPublishedArticle ? saveActionLabel : `${saveActionLabel} (consigliato)`),
    [isPublishedArticle, saveActionLabel]
  );
  const translationOfferSaveSkipLabel = useMemo(
    () => (isPublishedArticle ? "Aggiorna senza tradurre" : `${saveActionLabel} senza tradurre`),
    [isPublishedArticle, saveActionLabel]
  );
  const translationOfferPublishSkipLabel = "Pubblica senza tradurre";
  const sceneOptionsEn = useMemo(
    () => articleMapScenes.map((scene, index) => ({ id: scene.id, label: scene.title_en || scene.title_it || `Scene ${index + 1}` })),
    [articleMapScenes]
  );
  const sceneOptionsIt = useMemo(
    () => articleMapScenes.map((scene, index) => ({ id: scene.id, label: scene.title_it || scene.title_en || `Scena ${index + 1}` })),
    [articleMapScenes]
  );
  const primaryRouteCoordinates = useMemo(() => {
    if (!selectedVoyage || voyageWaypoints.length < 2) return null;

    if (voyageSegStart != null || voyageSegEnd != null) {
      const start = Math.max(0, Math.min(voyageSegStart ?? voyageSegEnd ?? 0, voyageWaypoints.length - 1));
      const end = Math.max(0, Math.min(voyageSegEnd ?? voyageSegStart ?? start, voyageWaypoints.length - 1));
      const segmentGeometry = buildVoyageSegmentGeometry(
        voyageWaypoints,
        selectedVoyage.type,
        start,
        end,
        selectedVoyageCachedGeometry
      );
      return segmentGeometry.length >= 2 ? segmentGeometry : null;
    }

    return selectedVoyageRouteCoordinates.length >= 2 ? selectedVoyageRouteCoordinates : null;
  }, [selectedVoyage, selectedVoyageCachedGeometry, selectedVoyageRouteCoordinates, voyageSegEnd, voyageSegStart, voyageWaypoints]);

  const handleSceneAnchorLink = useCallback((language: ArticleLanguage, sceneId: string, payload: { anchorId: string; anchorPreview: string }) => {
    setArticleMapScenes((currentScenes) =>
      currentScenes.map((scene) => {
        if (scene.id !== sceneId) return scene;
        return language === "en"
          ? { ...scene, anchor_id_en: payload.anchorId, anchor_preview_en: payload.anchorPreview }
          : { ...scene, anchor_id_it: payload.anchorId, anchor_preview_it: payload.anchorPreview };
      })
    );
  }, []);
  const previewTags = useMemo(
    () => selectedTagIds
      .map((tagId) => allTags.find((tag) => tag.id === tagId))
      .filter((tag): tag is { id: string; name: string } => Boolean(tag)),
    [allTags, selectedTagIds]
  );
  const previewStory = useMemo(
    () => allStories.find((story) => story.id === selectedStoryId) || null,
    [allStories, selectedStoryId]
  );
  const previewArticle = useMemo(() => {
    const safeStart = voyageSegStart ?? voyageSegEnd;
    const safeEnd = voyageSegEnd ?? voyageSegStart;
    const normalizedStart =
      selectedVoyageId && associationMode !== "full" && safeStart != null
        ? Math.max(0, Math.min(safeStart, voyageWaypoints.length - 1))
        : null;
    const normalizedEnd =
      selectedVoyageId && associationMode === "segment" && safeEnd != null
        ? Math.max(0, Math.min(safeEnd, voyageWaypoints.length - 1))
        : associationMode === "point"
          ? normalizedStart
          : null;
    const startWaypointId = normalizedStart != null ? voyageWaypoints[normalizedStart]?.id ?? null : null;
    const endWaypointId = normalizedEnd != null ? voyageWaypoints[normalizedEnd]?.id ?? startWaypointId : startWaypointId;

    return {
      id: id && id !== "new" ? id : "article-preview",
      title_en: titleEn || titleIt || "Untitled article",
      title_it: titleIt || titleEn || "Articolo senza titolo",
      slug: slug || "preview",
      slug_en: slugEn || slug || "preview",
      slug_it: slugIt || slug || "anteprima",
      excerpt_en: excerptEn,
      excerpt_it: excerptIt,
      content_en: contentEn,
      content_it: contentIt,
      article_map_scenes: articleMapScenes,
      cover_image: coverImage || null,
      instagram_story_image_en: instagramStoryImageEn || null,
      instagram_story_image_it: instagramStoryImageIt || null,
      instagram_story_use_cover_en: instagramStoryUseCoverEn,
      instagram_story_use_cover_it: instagramStoryUseCoverIt,
      category,
      published_at: initialPublishedAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      view_count: 0,
      story_id: selectedStoryId,
      latitude,
      longitude,
      location_name: locationName || null,
      voyage_id: selectedVoyageId,
      voyage_segment_start: normalizedStart,
      voyage_segment_end: normalizedEnd,
      voyage_waypoint_start_id: startWaypointId,
      voyage_waypoint_end_id: endWaypointId,
      cover_focal_x: coverFocal.focalX,
      cover_focal_y: coverFocal.focalY,
      cover_zoom: coverFocal.zoom,
    };
  }, [
    articleMapScenes,
    associationMode,
    category,
    contentEn,
    contentIt,
    coverFocal,
    coverImage,
    excerptEn,
    excerptIt,
    id,
    initialPublishedAt,
    instagramStoryImageEn,
    instagramStoryImageIt,
    instagramStoryUseCoverEn,
    instagramStoryUseCoverIt,
    latitude,
    locationName,
    longitude,
    selectedStoryId,
    selectedVoyageId,
    slug,
    slugEn,
    slugIt,
    titleEn,
    titleIt,
    voyageSegEnd,
    voyageSegStart,
    voyageWaypoints,
  ]);

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
          <button type="button" onClick={() => requestLeave("/admin/articles")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={16} /> Torna agli Articoli
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              className="inline-flex items-center gap-2 border border-border px-4 py-2 text-sm font-sans hover:bg-muted transition-colors"
            >
              <Eye size={14} /> Anteprima
            </button>
            <button
              type="button"
              onClick={() => void saveArticle("draft")}
              disabled={saving || !hasLocalChanges}
              title={hasLocalChanges ? undefined : "Nessuna modifica da salvare"}
              className={
                isPublishedArticle
                  ? "inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2 text-sm font-sans font-medium hover:bg-navy-light transition-colors disabled:opacity-50"
                  : "inline-flex items-center gap-2 border border-border px-4 py-2 text-sm font-sans hover:bg-muted transition-colors disabled:opacity-50"
              }
            >
              <Save size={14} /> {saveActionLabel}
            </button>
            {!isPublishedArticle && (
              <button
                type="button"
                onClick={() => setPublishChoiceOpen(true)}
                disabled={saving}
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2 text-sm font-sans font-medium hover:bg-navy-light transition-colors disabled:opacity-50"
              >
                <Send size={14} /> {primaryPublishActionLabel}
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8">
          {/* Main content */}
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border">
              <div className="flex gap-4">
                <button type="button" onClick={() => setActiveTab("en")} className={`pb-3 text-sm font-sans tracking-wide transition-colors border-b-2 ${activeTab === "en" ? "border-foreground text-foreground" : "border-transparent text-muted-foreground"}`}>English</button>
                <button type="button" onClick={() => setActiveTab("it")} className={`pb-3 text-sm font-sans tracking-wide transition-colors border-b-2 ${activeTab === "it" ? "border-foreground text-foreground" : "border-transparent text-muted-foreground"}`}>Italiano</button>
              </div>
              <button
                type="button"
                onClick={() => void handleAiTranslateMissing()}
                disabled={aiTranslating || seoOptimizing}
                className="mb-1 inline-flex items-center gap-2 border border-border px-3 py-1.5 text-xs font-sans tracking-wide text-muted-foreground hover:text-foreground hover:border-accent transition-colors disabled:opacity-50"
                title="Traduce solo i campi vuoti; il corpo mantiene struttura TipTap, titoli, media e didascalie al loro posto."
              >
                {aiTranslating ? <Loader2 size={14} className="animate-spin" /> : <Languages size={14} />}
                Traduci campi vuoti (IT↔EN)
              </button>
              {persistedArticleStatus === "published" && !isNew && (
                <button
                  type="button"
                  onClick={() => void runSeoOptimization(id, { force: true })}
                  disabled={saving || aiTranslating || seoOptimizing}
                  className="mb-1 inline-flex items-center gap-2 border border-border px-3 py-1.5 text-xs font-sans tracking-wide text-muted-foreground hover:text-foreground hover:border-accent transition-colors disabled:opacity-50"
                  title="Rigenera meta title, description, keyword e dati strutturati per l'articolo pubblicato."
                >
                  {seoOptimizing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  Ottimizza SEO
                </button>
              )}
            </div>

            {activeTab === "en" ? (
              <input type="text" value={titleEn} onChange={(e) => handleTitleEnChange(e.target.value)} placeholder="Article title (English)" className="w-full bg-transparent font-serif text-3xl md:text-4xl font-bold focus:outline-none placeholder:text-muted-foreground/30" />
            ) : (
              <input type="text" value={titleIt} onChange={(e) => handleTitleItChange(e.target.value)} placeholder="Titolo articolo (Italiano)" className="w-full bg-transparent font-serif text-3xl md:text-4xl font-bold focus:outline-none placeholder:text-muted-foreground/30" />
            )}

            {activeTab === "en" ? (
              <textarea value={excerptEn} onChange={(e) => setExcerptEn(e.target.value)} placeholder="Short excerpt (English)..." rows={2} className="w-full bg-transparent border-b border-border py-3 text-foreground/80 font-sans focus:outline-none focus:border-accent transition-colors resize-none" />
            ) : (
              <textarea value={excerptIt} onChange={(e) => setExcerptIt(e.target.value)} placeholder="Breve estratto (Italiano)..." rows={2} className="w-full bg-transparent border-b border-border py-3 text-foreground/80 font-sans focus:outline-none focus:border-accent transition-colors resize-none" />
            )}

            {activeTab === "en" ? (
              <RichTextEditor
                content={contentEn}
                onChange={setContentEn}
                placeholder="Start writing your article in English..."
                mapScenes={sceneOptionsEn}
                onMapSceneLink={(sceneId, payload) => handleSceneAnchorLink("en", sceneId, payload)}
              />
            ) : (
              <RichTextEditor
                content={contentIt}
                onChange={setContentIt}
                placeholder="Inizia a scrivere l'articolo in italiano..."
                mapScenes={sceneOptionsIt}
                onMapSceneLink={(sceneId, payload) => handleSceneAnchorLink("it", sceneId, payload)}
              />
            )}

            <ArticleMiniMapEditor
              value={articleMapScenes}
              onChange={setArticleMapScenes}
              activeLanguage={activeTab}
              primaryRouteCoordinates={primaryRouteCoordinates}
            />
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
                      onClick={() => setCoverCropOpen(true)}
                      className="absolute top-2 right-20 bg-primary/80 text-primary-foreground px-2 py-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity z-10 inline-flex items-center gap-1.5"
                    >
                      <Crop size={12} /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => { setCoverImage(""); setCoverFocal({ ...DEFAULT_COVER_FOCAL }); setCoverCropOpen(false); }}
                      className="absolute top-2 right-2 bg-primary/80 text-primary-foreground px-2 py-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity z-10"
                    >
                      Remove
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCoverCropOpen(true)}
                    className="inline-flex items-center gap-2 text-[11px] font-sans text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Crop size={13} /> Modifica ritaglio copertina
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => coverInputRef.current?.click()} className="w-full aspect-[16/10] border-2 border-dashed border-border flex items-center justify-center text-muted-foreground hover:border-accent hover:text-accent transition-colors">
                  <ImageIcon size={24} />
                </button>
              )}
              <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleCoverUpload(file); e.target.value = ""; }} />
            </div>
            <CoverCropDialog
              open={coverCropOpen}
              imageUrl={coverImage || null}
              value={coverFocal}
              onOpenChange={(nextOpen) => {
                if (!nextOpen) setCoverCropOpen(false);
              }}
              onCancel={() => setCoverCropOpen(false)}
              onConfirm={handleCoverCropConfirm}
            />

            <ArticleSeoPanel
              id={id}
              seoOptimization={seoOptimization}
              seoOptimizing={seoOptimizing}
              aiTranslating={aiTranslating}
              saving={saving}
              persistedArticleStatus={persistedArticleStatus}
              runSeoOptimization={runSeoOptimization}
            />

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

            {/* Tipo editoriale (interno) */}
            <div>
              <label
                className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block"
                title="Classificazione per il piano editoriale in dashboard; non è visibile come categoria pubblica."
              >
                Tipo editoriale
              </label>
              <select
                value={editorialType}
                onChange={(e) => setEditorialType((e.target.value || "") as "" | EditorialArticleType)}
                className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
              >
                <option value="">Non classificato</option>
                {(Object.keys(EDITORIAL_TYPE_LABELS) as EditorialArticleType[]).map((t) => (
                  <option key={t} value={t}>
                    {EDITORIAL_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground mt-1 font-sans">Uso interno admin — non sostituisce la categoria pubblica.</p>
            </div>

            {/* Slug (opzioni avanzate) */}
            <details className="border-t border-border/70 pt-3">
              <summary className="cursor-pointer text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground hover:text-foreground">
                Opzioni avanzate — Slug
              </summary>
              <div className="mt-3 space-y-3">
                <div>
                  <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">Slug EN</label>
                  <input
                    type="text"
                    value={slugEn}
                    onChange={(e) => {
                      setSlugEn(e.target.value);
                      setSlugEnManuallyEdited(true);
                    }}
                    placeholder="es. first-time-sailors"
                    className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1 font-sans">
                    URL pubblico in /en/logbook/. Generato automaticamente dal titolo inglese, modificabile a mano.
                  </p>
                </div>

                <div>
                  <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">Slug IT</label>
                  <input
                    type="text"
                    value={slugIt}
                    onChange={(e) => {
                      setSlugIt(e.target.value);
                      setSlugItManuallyEdited(true);
                    }}
                    placeholder="es. primi-velisti"
                    className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1 font-sans">
                    URL pubblico in /it/logbook/. Generato automaticamente dal titolo italiano, modificabile a mano.
                  </p>
                </div>

                <div>
                  <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">Slug canonico (legacy)</label>
                  <input
                    type="text"
                    value={slug}
                    onChange={(e) => {
                      setSlug(e.target.value);
                      setSlugManuallyEdited(true);
                    }}
                    className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1 font-sans">
                    Generato automaticamente dal titolo (EN, o IT se manca l'EN). Usato come fallback dove il sito non distingue ancora per lingua.
                  </p>
                </div>
              </div>
            </details>

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

            {serverScheduledAt && persistedArticleStatus === "scheduled" && (
              <div className="rounded-[14px] border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs font-sans text-foreground/90 leading-relaxed">
                <span className="font-medium text-amber-900 dark:text-amber-100">Programmato sul server</span> per{" "}
                {new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short" }).format(new Date(serverScheduledAt))}.
                Per cambiare data e ora usa il <span className="font-medium">Piano editoriale</span> in dashboard (non più da qui).
              </div>
            )}

            <ArticleGeoAssociationPanel
              locationName={locationName}
              setLocationName={setLocationName}
              latitude={latitude}
              setLatitude={setLatitude}
              longitude={longitude}
              setLongitude={setLongitude}
              geoSearchQuery={geoSearchQuery}
              setGeoSearchQuery={setGeoSearchQuery}
              geoSearching={geoSearching}
              handleGeoSearch={handleGeoSearch}
              geoMapRef={geoMapRef}
              geoMarkerRef={geoMarkerRef}
              allVoyages={allVoyages}
              selectedVoyageId={selectedVoyageId}
              setSelectedVoyageId={setSelectedVoyageId}
              voyageWaypoints={voyageWaypoints}
              associationMode={associationMode}
              setAssociationMode={setAssociationMode}
              handleAssociationModeChange={handleAssociationModeChange}
              voyageSegStart={voyageSegStart}
              setVoyageSegStart={setVoyageSegStart}
              voyageSegEnd={voyageSegEnd}
              setVoyageSegEnd={setVoyageSegEnd}
              handleSegmentStartChange={handleSegmentStartChange}
              handleSegmentEndChange={handleSegmentEndChange}
              selectPointWaypoint={selectPointWaypoint}
            />

            {/* Authors */}
            <AuthorSelector selectedIds={authorIds} onChange={setAuthorIds} />
          </div>
        </div>
      </div>

      <ArticlePreviewOverlay
        previewOpen={previewOpen}
        setPreviewOpen={setPreviewOpen}
        previewLang={previewLang}
        setPreviewLang={setPreviewLang}
        previewArticle={previewArticle as ComponentProps<typeof ArticleReader>["article"]}
        previewAuthors={previewAuthors}
        previewTags={previewTags}
        previewStory={previewStory as ComponentProps<typeof ArticleReader>["story"]}
        selectedVoyage={selectedVoyage}
        voyageWaypoints={voyageWaypoints}
        slug={slug}
      />

      <ArticleEditorDialogs
        publishChoiceOpen={publishChoiceOpen}
        setPublishChoiceOpen={setPublishChoiceOpen}
        handlePublishChoicePublishNow={handlePublishChoicePublishNow}
        handlePublishChoicePlanning={handlePublishChoicePlanning}
        primaryPublishActionLabel={primaryPublishActionLabel}
        leaveDialogOpen={leaveDialogOpen}
        leaveBusy={leaveBusy}
        handleStayOnLeaveDialog={handleStayOnLeaveDialog}
        handleDiscardLeaveFromEditor={handleDiscardLeaveFromEditor}
        handleLeaveSaveDraft={handleLeaveSaveDraft}
        leaveSaveActionLabel={leaveSaveActionLabel}
        handleLeavePublish={handleLeavePublish}
        showLeavePublishAction={!isPublishedArticle}
        translationOfferOpen={translationOfferOpen}
        translationOfferBusy={translationOfferBusy}
        translationOfferLabels={translationOfferLabels}
        translationOfferPublishSkipLabel={translationOfferPublishSkipLabel}
        translationOfferSaveSkipLabel={translationOfferSaveSkipLabel}
        pendingTranslationAction={pendingTranslationAction}
        handleTranslationOfferClose={handleTranslationOfferClose}
        handleTranslationOfferSkip={handleTranslationOfferSkip}
        handleTranslationOfferTranslateAndContinue={handleTranslationOfferTranslateAndContinue}
        saving={saving}
        aiTranslating={aiTranslating}
      />
    </div>
  );
};

export default ArticleEditor;
