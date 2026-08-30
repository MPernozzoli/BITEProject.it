import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EDITORIAL_TYPE_LABELS,
  contentFormatsForChannel,
  defaultCountsTowardMix,
  type ArticleForPlan,
  type EditorialArticleType,
  type EditorialChannelCode,
  type SlotForPlan,
  effectiveSlotType,
} from "@/lib/editorial-plan";
import { isAuthFailureError } from "@/lib/supabase-auth";
import { useNavigate } from "react-router-dom";
import { BarChart3, Bookmark, Eye, Heart, MessageCircle, MousePointerClick, Share2, TrendingUp } from "lucide-react";
import AdminArticleInsightSummary from "./AdminArticleInsightSummary";

type ArticleLite = {
  id: string;
  title_en: string;
  title_it: string;
  status: ArticleForPlan["status"];
  editorial_type: EditorialArticleType | null;
};

type TargetDb = {
  id: string;
  content_format: string;
  caption: string | null;
  status: string;
  syndication_batch_id: string | null;
  platform_post_id: string | null;
  platform_permalink: string | null;
  published_at: string | null;
  metrics_synced_at: string | null;
  editorial_media_assets: { id: string; title: string } | null;
};

type InsightRow = {
  id: string;
  target_id: string;
  captured_at: string;
  source: string;
  impressions: number;
  reach: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  clicks: number;
  follows: number;
  sentiment: string | null;
  notes: string | null;
};

type InsightDraft = {
  targetId: string;
  source: string;
  impressions: string;
  reach: string;
  views: string;
  likes: string;
  comments: string;
  shares: string;
  saves: string;
  clicks: string;
  follows: string;
  sentiment: string;
  notes: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slot: SlotForPlan | null;
  articles: ArticleLite[];
  allSlots: SlotForPlan[];
  channelId: string;
  channelCode: EditorialChannelCode;
  onDone: () => void | Promise<void>;
};

const emptyContent = (): Json => ({}) as Json;

const generateSlug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) || `bozza-${Date.now().toString(36)}`;

const PUBLISH_STATUS_OPTIONS = ["pending", "publishing", "published", "failed", "cancelled"] as const;
const INSIGHT_SOURCE_OPTIONS = ["manual", "instagram", "youtube", "tiktok", "import"] as const;

const formatMetric = (value: number) => new Intl.NumberFormat("it-IT").format(value);

export default function AdminEditorialPlanSlotDialog({
  open,
  onOpenChange,
  slot,
  articles,
  allSlots,
  channelId,
  channelCode,
  onDone,
}: Props) {
  const navigate = useNavigate();
  const isSite = channelCode === "site";
  const [tab, setTab] = useState("quick");
  const [saving, setSaving] = useState(false);
  const [titleIt, setTitleIt] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [excerptIt, setExcerptIt] = useState("");
  const [excerptEn, setExcerptEn] = useState("");
  const [draftType, setDraftType] = useState<EditorialArticleType>("support");
  const [assignId, setAssignId] = useState<string>("");
  const [overrideType, setOverrideType] = useState<EditorialArticleType | "">("");

  const [slotFormat, setSlotFormat] = useState<string>("");
  const [targets, setTargets] = useState<TargetDb[]>([]);
  const [insightsByTargetId, setInsightsByTargetId] = useState<Record<string, InsightRow[]>>({});
  const [insightDraft, setInsightDraft] = useState<InsightDraft>({
    targetId: "",
    source: "manual",
    impressions: "",
    reach: "",
    views: "",
    likes: "",
    comments: "",
    shares: "",
    saves: "",
    clicks: "",
    follows: "",
    sentiment: "",
    notes: "",
  });
  const [assetTitle, setAssetTitle] = useState("");
  const [assetSynopsis, setAssetSynopsis] = useState("");
  const [assetEditorialType, setAssetEditorialType] = useState<EditorialArticleType>("support");
  const [storagePath, setStoragePath] = useState("");
  const [uploading, setUploading] = useState(false);
  const [newTargetFormat, setNewTargetFormat] = useState<string>("");
  const [newTargetCaption, setNewTargetCaption] = useState("");
  const [syndicationBatch, setSyndicationBatch] = useState("");

  const formatOptions = useMemo(() => contentFormatsForChannel(channelCode), [channelCode]);

  const loadTargets = useCallback(async () => {
    if (!slot || isSite) return;
    const { data, error } = await supabase
      .from("editorial_publish_targets")
      .select("id, content_format, caption, status, syndication_batch_id, platform_post_id, platform_permalink, published_at, metrics_synced_at, editorial_media_assets(id, title)")
      .eq("editorial_plan_slot_id", slot.id);
    if (error) {
      console.error(error);
      return;
    }
    const rows = (data ?? []) as unknown as TargetDb[];
    setTargets(rows);
    const targetIds = rows.map((row) => row.id);
    if (targetIds.length === 0) {
      setInsightsByTargetId({});
      setInsightDraft((prev) => ({ ...prev, targetId: "" }));
      return;
    }

    const { data: insightRows, error: insightError } = await supabase
      .from("editorial_post_insights")
      .select("*")
      .in("target_id", targetIds)
      .order("captured_at", { ascending: false });
    if (insightError) {
      console.error(insightError);
      setInsightsByTargetId({});
      return;
    }
    const next: Record<string, InsightRow[]> = {};
    for (const row of (insightRows ?? []) as InsightRow[]) {
      if (!next[row.target_id]) next[row.target_id] = [];
      next[row.target_id].push(row);
    }
    setInsightsByTargetId(next);
    setInsightDraft((prev) => ({ ...prev, targetId: prev.targetId || targetIds[0] }));
  }, [slot, isSite]);

  useEffect(() => {
    if (open && slot && !isSite) {
      setSlotFormat(slot.content_format ?? "");
      void loadTargets();
    }
  }, [open, slot, isSite, loadTargets]);

  const assignedElsewhere = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of allSlots) {
      if (s.status === "assigned" && s.assigned_article_id && s.id !== slot?.id) {
        m.set(s.assigned_article_id, s.id);
      }
    }
    return m;
  }, [allSlots, slot?.id]);

  const draftOptions = useMemo(() => {
    return articles.filter((a) => {
      if (a.status !== "draft") return false;
      const other = assignedElsewhere.get(a.id);
      if (other && other !== slot?.id) return false;
      return true;
    });
  }, [articles, assignedElsewhere, slot?.id]);

  const effectiveArticle = slot ? articles.find((a) => a.id === slot.assigned_article_id) ?? null : null;
  const displayType = slot ? effectiveSlotType(slot, effectiveArticle ?? undefined) : null;

  const resetForm = () => {
    setTitleIt("");
    setTitleEn("");
    setExcerptIt("");
    setExcerptEn("");
    setAssignId("");
    setOverrideType("");
    setTab("quick");
    setTargets([]);
    setInsightsByTargetId({});
    setInsightDraft({
      targetId: "",
      source: "manual",
      impressions: "",
      reach: "",
      views: "",
      likes: "",
      comments: "",
      shares: "",
      saves: "",
      clicks: "",
      follows: "",
      sentiment: "",
      notes: "",
    });
    setAssetTitle("");
    setAssetSynopsis("");
    setStoragePath("");
    setNewTargetCaption("");
    setSyndicationBatch("");
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) resetForm();
    onOpenChange(next);
  };

  useEffect(() => {
    if (open && slot && isSite) {
      const sug = (slot.override_type ?? slot.suggested_type ?? "support") as EditorialArticleType;
      setDraftType(sug);
    }
  }, [open, slot, isSite]);

  const latestInsight = useMemo(() => {
    const all = Object.values(insightsByTargetId).flat();
    return all.sort((a, b) => b.captured_at.localeCompare(a.captured_at))[0] ?? null;
  }, [insightsByTargetId]);

  if (!slot) return null;

  const saveOverride = async () => {
    if (!overrideType) {
      const { error } = await supabase.from("editorial_plan_slots").update({ override_type: null }).eq("id", slot.id);
      if (error) toast.error(error.message);
      else toast.success("Override rimosso");
    } else {
      const { error } = await supabase
        .from("editorial_plan_slots")
        .update({ override_type: overrideType })
        .eq("id", slot.id);
      if (error) toast.error(error.message);
      else toast.success("Tipo forzato aggiornato");
    }
    await onDone();
  };

  const applySlotFormat = async () => {
    const fmt = slotFormat || null;
    const ctm = defaultCountsTowardMix(fmt);
    setSaving(true);
    const { error } = await supabase
      .from("editorial_plan_slots")
      .update({
        content_format: fmt,
        counts_toward_mix: ctm,
        updated_at: new Date().toISOString(),
      })
      .eq("id", slot.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Formato slot aggiornato.");
    await onDone();
  };

  const addPublishTarget = async () => {
    if (!newTargetFormat) {
      toast.error("Seleziona il formato di pubblicazione.");
      return;
    }
    if (!assetTitle.trim()) {
      toast.error("Titolo asset obbligatorio.");
      return;
    }
    setSaving(true);
    const { data: asset, error: aerr } = await supabase
      .from("editorial_media_assets")
      .insert({
        title: assetTitle.trim(),
        synopsis: assetSynopsis.trim() || null,
        editorial_type: assetEditorialType,
        storage_main_path: storagePath.trim() || null,
        status: "draft",
      })
      .select("id")
      .single();
    if (aerr || !asset) {
      toast.error(aerr?.message ?? "Creazione asset fallita");
      setSaving(false);
      return;
    }

    const batchRaw = syndicationBatch.trim();
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const batch = batchRaw && uuidRe.test(batchRaw) ? batchRaw : null;
    const { error: terr } = await supabase.from("editorial_publish_targets").insert({
      asset_id: asset.id,
      channel_id: channelId,
      editorial_plan_slot_id: slot.id,
      content_format: newTargetFormat,
      caption: newTargetCaption.trim() || null,
      syndication_batch_id: batch,
      status: "pending",
    });
    if (terr) {
      toast.error(terr.message);
      setSaving(false);
      return;
    }

    const { error: serr } = await supabase
      .from("editorial_plan_slots")
      .update({ status: "assigned", updated_at: new Date().toISOString() })
      .eq("id", slot.id);
    if (serr) toast.error(serr.message);
    else toast.success("Target aggiunto.");
    setSaving(false);
    setNewTargetCaption("");
    await loadTargets();
    await onDone();
  };

  const deleteTarget = async (id: string) => {
    setSaving(true);
    const { error } = await supabase.from("editorial_publish_targets").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      setSaving(false);
      return;
    }
    toast.success("Target rimosso.");
    const { count, error: cErr } = await supabase
      .from("editorial_publish_targets")
      .select("id", { count: "exact", head: true })
      .eq("editorial_plan_slot_id", slot.id);
    if (!cErr && (count ?? 0) === 0) {
      await supabase.from("editorial_plan_slots").update({ status: "open" }).eq("id", slot.id);
    }
    await loadTargets();
    setSaving(false);
    await onDone();
  };

  const updateTargetField = async (id: string, patch: Partial<Pick<TargetDb, "caption" | "status">>) => {
    setSaving(true);
    const { error } = await supabase
      .from("editorial_publish_targets")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Target aggiornato.");
    await loadTargets();
    await onDone();
  };

  const addInsight = async () => {
    if (!insightDraft.targetId) {
      toast.error("Seleziona un target.");
      return;
    }
    const toInt = (value: string) => Math.max(0, Number.parseInt(value, 10) || 0);
    setSaving(true);
    const { error } = await supabase.from("editorial_post_insights").insert({
      target_id: insightDraft.targetId,
      source: insightDraft.source || "manual",
      impressions: toInt(insightDraft.impressions),
      reach: toInt(insightDraft.reach),
      views: toInt(insightDraft.views),
      likes: toInt(insightDraft.likes),
      comments: toInt(insightDraft.comments),
      shares: toInt(insightDraft.shares),
      saves: toInt(insightDraft.saves),
      clicks: toInt(insightDraft.clicks),
      follows: toInt(insightDraft.follows),
      sentiment: insightDraft.sentiment || null,
      notes: insightDraft.notes.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Insight salvato.");
    setInsightDraft((prev) => ({
      ...prev,
      impressions: "",
      reach: "",
      views: "",
      likes: "",
      comments: "",
      shares: "",
      saves: "",
      clicks: "",
      follows: "",
      notes: "",
    }));
    await loadTargets();
    await onDone();
  };

  const deleteInsight = async (id: string) => {
    setSaving(true);
    const { error } = await supabase.from("editorial_post_insights").delete().eq("id", id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Insight rimosso.");
    await loadTargets();
    await onDone();
  };

  const quickDraft = async () => {
    const titIt = titleIt.trim() || titleEn.trim();
    const titEn = titleEn.trim() || titleIt.trim();
    if (!titIt) {
      toast.error("Inserisci almeno un titolo.");
      return;
    }
    let slug = generateSlug(titEn || titIt);
    const base = slug;
    let n = 0;
    while (n < 30) {
      const { data: clash } = await supabase.from("logbook_articles").select("id").eq("slug", slug).maybeSingle();
      if (!clash) break;
      n++;
      slug = `${base}-${n}`;
    }

    setSaving(true);
    const { data: art, error } = await supabase
      .from("logbook_articles")
      .insert({
        title_en: titEn || titIt,
        title_it: titIt,
        slug,
        excerpt_en: excerptEn.trim() || null,
        excerpt_it: excerptIt.trim() || null,
        content_en: emptyContent(),
        content_it: emptyContent(),
        category: "Notes from the Boat",
        status: "draft",
        editorial_type: draftType,
      })
      .select("id")
      .single();

    if (error || !art) {
      if (error && isAuthFailureError(error)) {
        await supabase.auth.signOut();
        navigate("/login", { state: { from: "/admin" } });
      } else toast.error(error?.message || "Creazione bozza fallita");
      setSaving(false);
      return;
    }

    const { error: slotErr } = await supabase
      .from("editorial_plan_slots")
      .update({
        assigned_article_id: art.id,
        status: "assigned",
      })
      .eq("id", slot.id);

    if (slotErr) {
      toast.error(slotErr.message);
      setSaving(false);
      return;
    }

    toast.success("Bozza creata e programmata nello slot.");
    setSaving(false);
    handleOpenChange(false);
    await onDone();
  };

  const assignExisting = async () => {
    if (!assignId) {
      toast.error("Seleziona un articolo.");
      return;
    }
    setSaving(true);
    const art = articles.find((a) => a.id === assignId);
    const sug = (slot.override_type ?? slot.suggested_type ?? "support") as EditorialArticleType;
    if (art && !art.editorial_type) {
      await supabase.from("logbook_articles").update({ editorial_type: sug }).eq("id", assignId);
    }

    const { error } = await supabase
      .from("editorial_plan_slots")
      .update({
        assigned_article_id: assignId,
        status: "assigned",
      })
      .eq("id", slot.id);

    if (error) {
      if (isAuthFailureError(error)) {
        await supabase.auth.signOut();
        navigate("/login", { state: { from: "/admin" } });
      } else toast.error(error.message);
      setSaving(false);
      return;
    }

    toast.success("Articolo programmato nello slot.");
    setSaving(false);
    handleOpenChange(false);
    await onDone();
  };

  const freeSlot = async () => {
    setSaving(true);
    if (!isSite) {
      await supabase.from("editorial_publish_targets").delete().eq("editorial_plan_slot_id", slot.id);
    }
    const { error } = await supabase
      .from("editorial_plan_slots")
      .update({
        assigned_article_id: null,
        status: "open",
      })
      .eq("id", slot.id);
    if (error) toast.error(error.message);
    else toast.success("Slot liberato.");
    setSaving(false);
    handleOpenChange(false);
    await onDone();
  };

  const skipSlot = async () => {
    setSaving(true);
    const { error } = await supabase.from("editorial_plan_slots").update({ status: "skipped" }).eq("id", slot.id);
    if (error) toast.error(error.message);
    else toast.success("Slot saltato.");
    setSaving(false);
    handleOpenChange(false);
    await onDone();
  };

  const reopenSlot = async () => {
    setSaving(true);
    const { error } = await supabase.from("editorial_plan_slots").update({ status: "open" }).eq("id", slot.id);
    if (error) toast.error(error.message);
    else toast.success("Slot riaperto.");
    setSaving(false);
    handleOpenChange(false);
    await onDone();
  };

  if (!isSite) {
    const storyNote = slot.counts_toward_mix === false;
    const metricCards = latestInsight
      ? [
          { label: "Reach", value: latestInsight.reach, icon: TrendingUp },
          { label: "Views", value: latestInsight.views, icon: Eye },
          { label: "Like", value: latestInsight.likes, icon: Heart },
          { label: "Commenti", value: latestInsight.comments, icon: MessageCircle },
        ]
      : [];
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto border-border/90 p-0 sm:rounded-[24px]">
          <DialogHeader className="border-b border-border/60 bg-muted/20 px-6 py-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Slot social</p>
                <DialogTitle className="mt-1 font-serif text-2xl">
                  {slot.slot_date} · {String(slot.slot_time).slice(0, 5)}
                </DialogTitle>
                {storyNote && (
                  <p className="mt-1 text-xs text-muted-foreground">Storia: non conta nel mix pillar/support/utility.</p>
                )}
              </div>
              <div className="rounded-[16px] border border-border/70 bg-background/75 px-3 py-2 text-xs text-muted-foreground">
                {targets.length} target · {Object.values(insightsByTargetId).flat().length} insight
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-5 px-6 py-5 text-sm">
            {latestInsight ? (
              <div className="grid gap-3 sm:grid-cols-4">
                {metricCards.map(({ label, value, icon: Icon }) => (
                  <div key={label} className="rounded-[16px] border border-border/70 bg-background/75 p-3">
                    <Icon className="mb-2 size-4 text-accent" aria-hidden />
                    <p className="font-sans text-lg font-semibold tabular-nums">{formatMetric(value)}</p>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-[18px] border border-dashed border-border bg-muted/20 p-4">
                <p className="font-medium">Nessun insight ancora raccolto</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Dopo la pubblicazione puoi salvare reach, views, salvataggi e note qualitative per confrontare i post nel calendario.
                </p>
              </div>
            )}

            <div className="rounded-[18px] border border-border/80 bg-background/70 p-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <div>
                  <label htmlFor="slot-format" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    Formato ricorrenza slot
                  </label>
                  <select
                    id="slot-format"
                    value={slotFormat}
                    onChange={(e) => setSlotFormat(e.target.value)}
                    className="mt-1 min-h-11 w-full rounded-[14px] border border-border bg-background/90 px-3 py-2 text-xs font-sans"
                  >
                    <option value="">Nessun formato</option>
                    {formatOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void applySlotFormat()}>
                  Applica formato
                </Button>
              </div>
            </div>

            <div className="rounded-[18px] border border-border/80 p-4">
              <div className="mb-4 flex items-center gap-2">
                <BarChart3 className="size-4 text-accent" aria-hidden />
                <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Nuovo asset + uscita</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor="asset-title" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    Titolo asset
                  </label>
                  <input
                    id="asset-title"
                    value={assetTitle}
                    onChange={(e) => setAssetTitle(e.target.value)}
                    className="mt-1 min-h-11 w-full rounded-[14px] border border-border bg-background/90 px-3 py-2 text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="asset-synopsis" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    Sinossi / note
                  </label>
                  <textarea
                    id="asset-synopsis"
                    value={assetSynopsis}
                    onChange={(e) => setAssetSynopsis(e.target.value)}
                    rows={2}
                    className="mt-1 w-full rounded-[14px] border border-border bg-background/90 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="asset-type" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    Tipo editoriale
                  </label>
                  <select
                    id="asset-type"
                    value={assetEditorialType}
                    onChange={(e) => setAssetEditorialType(e.target.value as EditorialArticleType)}
                    className="mt-1 min-h-11 w-full rounded-[14px] border border-border bg-background/90 px-3 py-2 text-sm"
                  >
                    {(Object.keys(EDITORIAL_TYPE_LABELS) as EditorialArticleType[]).map((t) => (
                      <option key={t} value={t}>
                        {EDITORIAL_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="target-format" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    Formato pubblicazione
                  </label>
                  <select
                    id="target-format"
                    value={newTargetFormat}
                    onChange={(e) => setNewTargetFormat(e.target.value)}
                    className="mt-1 min-h-11 w-full rounded-[14px] border border-border bg-background/90 px-3 py-2 text-sm"
                  >
                    <option value="">Seleziona formato</option>
                    {formatOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="asset-file" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    File media
                  </label>
                  <input
                    id="asset-file"
                    type="file"
                    accept="video/mp4,video/quicktime,image/jpeg,image/png,image/webp"
                    disabled={uploading || saving}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      setUploading(true);
                      const safe =
                        typeof crypto !== "undefined" && crypto.randomUUID
                          ? crypto.randomUUID()
                          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
                      const objectPath = `${channelId}/${safe}-${file.name.replace(/[^\w.-]+/g, "_")}`;
                      const { error: uerr } = await supabase.storage.from("editorial-media").upload(objectPath, file, {
                        upsert: false,
                        contentType: file.type || undefined,
                      });
                      setUploading(false);
                      if (uerr) {
                        toast.error(uerr.message);
                        return;
                      }
                      setStoragePath(objectPath);
                      toast.success("File caricato.");
                    }}
                    className="mt-1 block w-full text-xs"
                  />
                </div>
                <input
                  aria-label="Path storage"
                  placeholder="Path storage opzionale"
                  value={storagePath}
                  onChange={(e) => setStoragePath(e.target.value)}
                  className="min-h-11 rounded-[14px] border border-border bg-background/90 px-3 py-2 text-xs font-mono sm:col-span-2"
                />
                <input
                  aria-label="Syndication batch UUID"
                  placeholder="Syndication batch UUID opzionale"
                  value={syndicationBatch}
                  onChange={(e) => setSyndicationBatch(e.target.value)}
                  className="min-h-11 rounded-[14px] border border-border bg-background/90 px-3 py-2 text-xs font-mono sm:col-span-2"
                />
                <textarea
                  aria-label="Caption piattaforma"
                  placeholder="Caption piattaforma"
                  value={newTargetCaption}
                  onChange={(e) => setNewTargetCaption(e.target.value)}
                  rows={3}
                  className="rounded-[14px] border border-border bg-background/90 px-3 py-2 text-sm sm:col-span-2"
                />
              </div>
              <Button type="button" disabled={saving} onClick={() => void addPublishTarget()} className="mt-4">
                Crea asset e target
              </Button>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Uscite pianificate</p>
              {targets.length === 0 ? (
                <p className="rounded-[16px] bg-muted/30 p-4 text-xs text-muted-foreground">Nessun target.</p>
              ) : (
                <ul className="space-y-2">
                  {targets.map((t) => {
                    const insightCount = insightsByTargetId[t.id]?.length ?? 0;
                    return (
                      <li key={t.id} className="rounded-[16px] border border-border/70 bg-muted/20 p-3">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="font-medium">{t.editorial_media_assets?.title ?? "Asset senza titolo"}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {t.content_format} · {insightCount} insight · batch {t.syndication_batch_id ?? "non assegnato"}
                            </p>
                            {(t.platform_post_id || t.metrics_synced_at) && (
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                {t.platform_post_id ? `Post ID ${t.platform_post_id}` : "Post ID non registrato"}
                                {t.metrics_synced_at
                                  ? ` · metriche ${new Date(t.metrics_synced_at).toLocaleString("it-IT")}`
                                  : " · metriche non sincronizzate"}
                              </p>
                            )}
                            {t.platform_permalink && (
                              <a
                                href={t.platform_permalink}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-1 inline-flex text-[11px] text-accent hover:underline"
                              >
                                Apri post pubblicato
                              </a>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <select
                              value={t.status}
                              onChange={(e) => void updateTargetField(t.id, { status: e.target.value })}
                              disabled={saving}
                              className="min-h-9 rounded-[12px] border border-border bg-background/90 px-2 text-xs"
                              aria-label="Stato target"
                            >
                              {PUBLISH_STATUS_OPTIONS.map((status) => (
                                <option key={status} value={status}>
                                  {status}
                                </option>
                              ))}
                            </select>
                            <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void deleteTarget(t.id)}>
                              Elimina
                            </Button>
                          </div>
                        </div>
                        <textarea
                          value={t.caption ?? ""}
                          onChange={(e) =>
                            setTargets((prev) => prev.map((row) => (row.id === t.id ? { ...row, caption: e.target.value } : row)))
                          }
                          onBlur={(e) => void updateTargetField(t.id, { caption: e.target.value.trim() || null })}
                          rows={2}
                          aria-label="Caption target"
                          className="mt-3 w-full rounded-[14px] border border-border bg-background/90 px-3 py-2 text-xs"
                          placeholder="Caption target"
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="rounded-[18px] border border-border/80 p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Insight post</p>
                  <p className="mt-1 text-xs text-muted-foreground">Snapshot manuali o importati, ordinati dal più recente.</p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <select
                  value={insightDraft.targetId}
                  onChange={(e) => setInsightDraft((prev) => ({ ...prev, targetId: e.target.value }))}
                  className="min-h-11 rounded-[14px] border border-border bg-background/90 px-3 py-2 text-xs sm:col-span-2"
                  aria-label="Target insight"
                >
                  <option value="">Seleziona target</option>
                  {targets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.content_format} · {target.editorial_media_assets?.title ?? target.id}
                    </option>
                  ))}
                </select>
                <select
                  value={insightDraft.source}
                  onChange={(e) => setInsightDraft((prev) => ({ ...prev, source: e.target.value }))}
                  className="min-h-11 rounded-[14px] border border-border bg-background/90 px-3 py-2 text-xs"
                  aria-label="Fonte insight"
                >
                  {INSIGHT_SOURCE_OPTIONS.map((source) => (
                    <option key={source} value={source}>
                      {source}
                    </option>
                  ))}
                </select>
                {(
                  [
                    ["impressions", "Impression"],
                    ["reach", "Reach"],
                    ["views", "Views"],
                    ["likes", "Like"],
                    ["comments", "Commenti"],
                    ["shares", "Condivisioni"],
                    ["saves", "Salvataggi"],
                    ["clicks", "Click"],
                    ["follows", "Follow"],
                  ] as const
                ).map(([key, label]) => (
                  <input
                    key={key}
                    type="number"
                    min={0}
                    inputMode="numeric"
                    placeholder={label}
                    value={insightDraft[key]}
                    onChange={(e) => setInsightDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                    className="min-h-11 rounded-[14px] border border-border bg-background/90 px-3 py-2 text-xs"
                    aria-label={label}
                  />
                ))}
                <select
                  value={insightDraft.sentiment}
                  onChange={(e) => setInsightDraft((prev) => ({ ...prev, sentiment: e.target.value }))}
                  className="min-h-11 rounded-[14px] border border-border bg-background/90 px-3 py-2 text-xs"
                  aria-label="Sentiment"
                >
                  <option value="">Sentiment</option>
                  <option value="positive">positive</option>
                  <option value="neutral">neutral</option>
                  <option value="negative">negative</option>
                </select>
                <textarea
                  value={insightDraft.notes}
                  onChange={(e) => setInsightDraft((prev) => ({ ...prev, notes: e.target.value }))}
                  rows={3}
                  placeholder="Insight qualitativo: cosa ha funzionato, commenti ricorrenti, hook da riusare..."
                  className="rounded-[14px] border border-border bg-background/90 px-3 py-2 text-xs sm:col-span-3"
                />
              </div>
              <Button type="button" size="sm" disabled={saving || targets.length === 0} onClick={() => void addInsight()} className="mt-3">
                Salva insight
              </Button>

              <div className="mt-5 space-y-2">
                {Object.values(insightsByTargetId).flat().length === 0 ? (
                  <p className="text-xs text-muted-foreground">Non ci sono ancora snapshot per questo slot.</p>
                ) : (
                  Object.values(insightsByTargetId)
                    .flat()
                    .sort((a, b) => b.captured_at.localeCompare(a.captured_at))
                    .map((insight) => (
                      <div key={insight.id} className="rounded-[14px] bg-muted/30 p-3 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">
                            {new Date(insight.captured_at).toLocaleDateString("it-IT")} · {insight.source}
                          </span>
                          <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void deleteInsight(insight.id)}>
                            Rimuovi
                          </Button>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-muted-foreground">
                          <span className="inline-flex items-center gap-1"><Eye className="size-3" />{formatMetric(insight.views)}</span>
                          <span className="inline-flex items-center gap-1"><Heart className="size-3" />{formatMetric(insight.likes)}</span>
                          <span className="inline-flex items-center gap-1"><MessageCircle className="size-3" />{formatMetric(insight.comments)}</span>
                          <span className="inline-flex items-center gap-1"><Share2 className="size-3" />{formatMetric(insight.shares)}</span>
                          <span className="inline-flex items-center gap-1"><Bookmark className="size-3" />{formatMetric(insight.saves)}</span>
                          <span className="inline-flex items-center gap-1"><MousePointerClick className="size-3" />{formatMetric(insight.clicks)}</span>
                        </div>
                        {insight.notes && <p className="mt-2 leading-relaxed text-foreground/80">{insight.notes}</p>}
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="border-t border-border/60 bg-muted/20 px-6 py-4 sm:justify-between">
            <Button type="button" variant="outline" disabled={saving} onClick={() => void freeSlot()}>
              Libera slot (rimuove tutti i target)
            </Button>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Chiudi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md sm:rounded-[22px] border-border/90">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            Slot {slot.slot_date} · {String(slot.slot_time).slice(0, 5)}
          </DialogTitle>
          {displayType && (
            <p className="text-xs text-muted-foreground font-sans">
              Tipo effettivo: <span className="text-foreground font-medium">{EDITORIAL_TYPE_LABELS[displayType]}</span>
            </p>
          )}
          {slot.counts_toward_mix === false && (
            <p className="text-xs text-muted-foreground">Questo formato non conta nel mix.</p>
          )}
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground self-center">Override tipo</span>
            <select
              value={overrideType === "" ? "" : overrideType}
              onChange={(e) => setOverrideType((e.target.value || "") as EditorialArticleType | "")}
              className="rounded-[14px] border border-border bg-background/80 px-2 py-1.5 text-xs font-sans"
            >
              <option value="">(nessuno — usa suggerito)</option>
              {(Object.keys(EDITORIAL_TYPE_LABELS) as EditorialArticleType[]).map((t) => (
                <option key={t} value={t}>
                  {EDITORIAL_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <Button type="button" size="sm" variant="secondary" onClick={() => void saveOverride()}>
              Applica override
            </Button>
          </div>

          {slot.status === "skipped" && (
            <p className="text-sm text-muted-foreground rounded-[14px] border border-dashed border-border/80 p-3">
              Questo slot è stato saltato per la pianificazione.
            </p>
          )}

          {slot.status === "assigned" && slot.assigned_article_id && (
            <div className="rounded-[16px] border border-border/80 bg-muted/30 p-3 space-y-2">
              <p className="text-xs text-muted-foreground">Articolo collegato</p>
              <Link
                to={`/admin/article/${slot.assigned_article_id}`}
                className="text-sm font-medium text-accent hover:underline"
              >
                {effectiveArticle?.title_it || effectiveArticle?.title_en || slot.assigned_article_id}
              </Link>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void freeSlot()}>
                  Libera slot
                </Button>
              </div>
              <AdminArticleInsightSummary
                articleId={slot.assigned_article_id}
                titleFallback={effectiveArticle?.title_it || effectiveArticle?.title_en}
              />
            </div>
          )}

          {slot.status === "open" && (
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="w-full">
                <TabsTrigger value="quick" className="flex-1 text-xs">
                  Bozza rapida
                </TabsTrigger>
                <TabsTrigger value="assign" className="flex-1 text-xs">
                  Assegna bozza
                </TabsTrigger>
              </TabsList>
              <TabsContent value="quick" className="space-y-3 pt-3">
                <div>
                  <label className="text-[10px] uppercase text-muted-foreground">Titolo (IT)</label>
                  <input
                    value={titleIt}
                    onChange={(e) => setTitleIt(e.target.value)}
                    className="mt-1 w-full rounded-[14px] border border-border bg-background/80 px-3 py-2 font-sans text-sm"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-muted-foreground">Titolo (EN)</label>
                  <input
                    value={titleEn}
                    onChange={(e) => setTitleEn(e.target.value)}
                    className="mt-1 w-full rounded-[14px] border border-border bg-background/80 px-3 py-2 font-sans text-sm"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-muted-foreground">Sinossi (IT)</label>
                  <textarea
                    value={excerptIt}
                    onChange={(e) => setExcerptIt(e.target.value)}
                    rows={2}
                    className="mt-1 w-full rounded-[14px] border border-border bg-background/80 px-3 py-2 font-sans text-sm resize-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-muted-foreground">Sinossi (EN)</label>
                  <textarea
                    value={excerptEn}
                    onChange={(e) => setExcerptEn(e.target.value)}
                    rows={2}
                    className="mt-1 w-full rounded-[14px] border border-border bg-background/80 px-3 py-2 font-sans text-sm resize-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-muted-foreground">Tipo editoriale</label>
                  <select
                    value={draftType}
                    onChange={(e) => setDraftType(e.target.value as EditorialArticleType)}
                    className="mt-1 w-full rounded-[14px] border border-border bg-background/80 px-3 py-2 font-sans text-sm"
                  >
                    {(Object.keys(EDITORIAL_TYPE_LABELS) as EditorialArticleType[]).map((t) => (
                      <option key={t} value={t}>
                        {EDITORIAL_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>
                <Button type="button" disabled={saving} onClick={() => void quickDraft()}>
                  Crea bozza e programma
                </Button>
              </TabsContent>
              <TabsContent value="assign" className="space-y-3 pt-3">
                <select
                  value={assignId}
                  onChange={(e) => setAssignId(e.target.value)}
                  className="w-full rounded-[14px] border border-border bg-background/80 px-3 py-2 font-sans text-sm"
                >
                  <option value="">— Seleziona bozza —</option>
                  {draftOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title_it || a.title_en}
                    </option>
                  ))}
                </select>
                <Button type="button" disabled={saving} onClick={() => void assignExisting()}>
                  Programma nello slot
                </Button>
              </TabsContent>
            </Tabs>
          )}
        </div>

        <DialogFooter className="flex flex-wrap gap-2 sm:justify-between">
          <div className="flex gap-2">
            {slot.status === "skipped" ? (
              <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={() => void reopenSlot()}>
                Riapri slot
              </Button>
            ) : slot.status === "open" ? (
              <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => void skipSlot()}>
                Salta slot
              </Button>
            ) : null}
          </div>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Chiudi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
