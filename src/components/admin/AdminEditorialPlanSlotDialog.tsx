import { useEffect, useMemo, useState } from "react";
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
  type ArticleForPlan,
  type EditorialArticleType,
  type SlotForPlan,
  effectiveSlotType,
} from "@/lib/editorial-plan";
import { isAuthFailureError } from "@/lib/supabase-auth";
import { useNavigate } from "react-router-dom";

type ArticleLite = {
  id: string;
  title_en: string;
  title_it: string;
  status: ArticleForPlan["status"];
  editorial_type: EditorialArticleType | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slot: SlotForPlan | null;
  articles: ArticleLite[];
  allSlots: SlotForPlan[];
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

export default function AdminEditorialPlanSlotDialog({ open, onOpenChange, slot, articles, allSlots, onDone }: Props) {
  const navigate = useNavigate();
  const [tab, setTab] = useState("quick");
  const [saving, setSaving] = useState(false);
  const [titleIt, setTitleIt] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [excerptIt, setExcerptIt] = useState("");
  const [excerptEn, setExcerptEn] = useState("");
  const [draftType, setDraftType] = useState<EditorialArticleType>("support");
  const [assignId, setAssignId] = useState<string>("");
  const [overrideType, setOverrideType] = useState<EditorialArticleType | "">("");

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
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) resetForm();
    onOpenChange(next);
  };

  useEffect(() => {
    if (open && slot) {
      const sug = (slot.override_type ?? slot.suggested_type ?? "support") as EditorialArticleType;
      setDraftType(sug);
    }
  }, [open, slot]);

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

    toast.success("Bozza creata e collegata allo slot.");
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

    toast.success("Articolo associato allo slot.");
    setSaving(false);
    handleOpenChange(false);
    await onDone();
  };

  const freeSlot = async () => {
    setSaving(true);
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md sm:rounded-[22px] border-stone-200/90">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            Slot {slot.slot_date} · {String(slot.slot_time).slice(0, 5)}
          </DialogTitle>
          {displayType && (
            <p className="text-xs text-muted-foreground font-sans">
              Tipo effettivo:{" "}
              <span className="text-foreground font-medium">{EDITORIAL_TYPE_LABELS[displayType]}</span>
            </p>
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
                  Crea bozza e assegna
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
                  Assegna allo slot
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
