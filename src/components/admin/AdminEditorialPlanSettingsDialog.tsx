import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Separator } from "@/components/ui/separator";
import {
  EDITORIAL_CHANNEL_LABELS,
  EDITORIAL_CHANNEL_ORDER,
  contentFormatsForChannel,
  oauthProviderForChannel,
  type EditorialChannelCode,
  WEEKDAY_LABELS_IT,
} from "@/lib/editorial-plan";
import { isAuthFailureError } from "@/lib/supabase-auth";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Link2, LogIn, Trash2 } from "lucide-react";

export type WeeklySlotFormRow = {
  localKey: string;
  day_of_week: number;
  time_of_day: string;
  content_format: string;
};

type ChannelRow = Database["public"]["Tables"]["editorial_plan_channels"]["Row"];
type WeeklyRow = Database["public"]["Tables"]["editorial_plan_weekly_slots"]["Row"];
type OauthRow = Database["public"]["Tables"]["social_oauth_connections"]["Row"];
type OauthRowLoaded = Pick<
  OauthRow,
  "id" | "channel_id" | "provider" | "account_label" | "scopes" | "access_token_expires_at" | "updated_at"
> & { refresh_token_encrypted?: string | null };

type ChannelDraft = {
  channelId: string;
  horizonWeeks: number;
  mixPillar: number;
  mixSupport: number;
  mixUtility: number;
  timezone: string;
  slotRows: WeeklySlotFormRow[];
  oauthId: string | null;
  oauthProvider: string;
  oauthAccountLabel: string;
  oauthScopes: string;
  /** Presenza token lato server (non memorizziamo il segreto in stato React). */
  oauthHasToken: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sezione accordion aperta all’apertura della modale. */
  initialChannelCode: EditorialChannelCode;
  onSaved: () => void | Promise<void>;
};

const uuid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const emptySlotRow = (): WeeklySlotFormRow => ({
  localKey: uuid(),
  day_of_week: 1,
  time_of_day: "09:00",
  content_format: "",
});

const OAUTH_PROVIDER_OPTIONS = [
  { value: "meta_instagram", label: "Meta / Instagram" },
  { value: "google_youtube", label: "Google / YouTube" },
  { value: "tiktok", label: "TikTok" },
] as const;

export default function AdminEditorialPlanSettingsDialog({
  open,
  onOpenChange,
  initialChannelCode,
  onSaved,
}: Props) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState<Partial<Record<EditorialChannelCode, ChannelDraft>>>({});
  const [savingCode, setSavingCode] = useState<EditorialChannelCode | null>(null);
  const [savingOAuthCode, setSavingOAuthCode] = useState<EditorialChannelCode | null>(null);
  const [oauthRedirecting, setOauthRedirecting] = useState<EditorialChannelCode | null>(null);
  const openGeneration = useRef(0);

  const oauthLoginButtonLabel = (code: EditorialChannelCode): string => {
    if (code === "instagram_bite" || code === "instagram_dogs") return "Accedi con Instagram";
    if (code === "youtube") return "Accedi con YouTube";
    if (code === "tiktok") return "Accedi con TikTok";
    return "Accedi con OAuth";
  };

  /** Cosa vede l’utente dopo il tap (login ufficiale del provider). */
  const oauthLoginSubhint = (code: EditorialChannelCode): string => {
    if (code === "instagram_bite" || code === "instagram_dogs") {
      return "Si apre il login Meta (Facebook): non esiste un OAuth “solo Instagram” per la pubblicazione API; autorizzi Meta e colleghi l’Instagram Business legato a una Pagina.";
    }
    if (code === "youtube") {
      return "Si apre Google: accedi con l’account che possiede il canale YouTube da usare per questo canale editoriale.";
    }
    if (code === "tiktok") {
      return "Si apre TikTok: confermi l’accesso per l’account che pubblicherà da questo canale.";
    }
    return "";
  };

  const updateDraft = useCallback((code: EditorialChannelCode, patch: Partial<ChannelDraft>) => {
    setDrafts((prev) => {
      const cur = prev[code];
      if (!cur) return prev;
      return { ...prev, [code]: { ...cur, ...patch } };
    });
  }, []);

  const setSlotRowsFor = useCallback((code: EditorialChannelCode, fn: (rows: WeeklySlotFormRow[]) => WeeklySlotFormRow[]) => {
    setDrafts((prev) => {
      const cur = prev[code];
      if (!cur) return prev;
      return { ...prev, [code]: { ...cur, slotRows: fn(cur.slotRows) } };
    });
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const chRes = await supabase.from("editorial_plan_channels").select("*").order("code", { ascending: true });
      if (chRes.error && isAuthFailureError(chRes.error)) {
        await supabase.auth.signOut();
        navigate("/login", { state: { from: "/admin" } });
        return;
      }
      if (chRes.error) {
        toast.error(chRes.error.message);
        return;
      }

      const channels = (chRes.data ?? []) as ChannelRow[];
      const ids = channels.map((c) => c.id);
      const [wRes, oRes] = await Promise.all([
        ids.length
          ? supabase.from("editorial_plan_weekly_slots").select("*").in("channel_id", ids).order("sort_order", { ascending: true })
          : Promise.resolve({ data: [] as WeeklyRow[], error: null }),
        ids.length
          ? supabase
              .from("social_oauth_connections")
              .select("id, channel_id, provider, account_label, scopes, access_token_expires_at, updated_at, refresh_token_encrypted")
              .in("channel_id", ids)
          : Promise.resolve({ data: [] as OauthRowLoaded[], error: null }),
      ]);

      if (wRes.error) {
        toast.error(wRes.error.message);
        return;
      }
      if (oRes.error) {
        toast.error(oRes.error.message);
        return;
      }

      const weeklyByChannel = new Map<string, WeeklyRow[]>();
      for (const row of wRes.data ?? []) {
        const list = weeklyByChannel.get(row.channel_id) ?? [];
        list.push(row);
        weeklyByChannel.set(row.channel_id, list);
      }
      for (const [cid, list] of weeklyByChannel) {
        list.sort((a, b) => a.sort_order - b.sort_order);
        weeklyByChannel.set(cid, list);
      }

      const oauthByChannel = new Map<string, OauthRowLoaded>();
      for (const row of oRes.data ?? []) {
        oauthByChannel.set(row.channel_id, row as OauthRowLoaded);
      }

      const byCode = new Map(channels.map((c) => [c.code as EditorialChannelCode, c]));
      const next: Partial<Record<EditorialChannelCode, ChannelDraft>> = {};

      for (const code of EDITORIAL_CHANNEL_ORDER) {
        const ch = byCode.get(code);
        if (!ch) continue;
        const rows = weeklyByChannel.get(ch.id) ?? [];
        const oauth = oauthByChannel.get(ch.id);
        next[code] = {
          channelId: ch.id,
          horizonWeeks: ch.horizon_weeks,
          mixPillar: Number(ch.mix_pillar),
          mixSupport: Number(ch.mix_support),
          mixUtility: Number(ch.mix_utility),
          timezone: ch.timezone || "Europe/Rome",
          slotRows:
            rows.length > 0
              ? rows.map((r) => ({
                  localKey: r.id,
                  day_of_week: r.day_of_week,
                  time_of_day: (r.time_of_day as string).slice(0, 5),
                  content_format: r.content_format ?? "",
                }))
              : [emptySlotRow()],
          oauthId: oauth?.id ?? null,
          oauthProvider: oauth?.provider ?? oauthProviderForChannel(code),
          oauthAccountLabel: oauth?.account_label ?? "",
          oauthScopes: oauth?.scopes ?? "",
          oauthHasToken: Boolean(oauth?.refresh_token_encrypted && oauth.refresh_token_encrypted.length > 0),
        };
      }

      setDrafts(next);
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    if (!open) return;
    openGeneration.current += 1;
    void loadAll();
  }, [open, loadAll]);

  const saveChannel = async (code: EditorialChannelCode) => {
    const d = drafts[code];
    if (!d) return;

    const sum = d.mixPillar + d.mixSupport + d.mixUtility;
    if (Math.abs(sum - 100) > 0.05) {
      toast.error(`${EDITORIAL_CHANNEL_LABELS[code]}: il mix deve sommare a 100%.`);
      return;
    }
    if (d.slotRows.length === 0) {
      toast.error(`${EDITORIAL_CHANNEL_LABELS[code]}: aggiungi almeno uno slot settimanale.`);
      return;
    }

    setSavingCode(code);
    const today = format(new Date(), "yyyy-MM-dd");

    const { error: channelErr } = await supabase
      .from("editorial_plan_channels")
      .update({
        weekly_count: d.slotRows.length,
        horizon_weeks: d.horizonWeeks,
        mix_pillar: d.mixPillar,
        mix_support: d.mixSupport,
        mix_utility: d.mixUtility,
        timezone: d.timezone,
        updated_at: new Date().toISOString(),
      })
      .eq("id", d.channelId);
    if (channelErr) {
      toast.error(channelErr.message);
      setSavingCode(null);
      return;
    }

    const { error: delWeeklyErr } = await supabase.from("editorial_plan_weekly_slots").delete().eq("channel_id", d.channelId);
    if (delWeeklyErr) {
      toast.error(delWeeklyErr.message);
      setSavingCode(null);
      return;
    }

    const inserts = d.slotRows.map((row, i) => ({
      channel_id: d.channelId,
      day_of_week: row.day_of_week,
      time_of_day: row.time_of_day.length === 5 ? `${row.time_of_day}:00` : row.time_of_day,
      sort_order: i,
      content_format: code !== "site" && row.content_format ? row.content_format : null,
    }));
    const { error: insWeeklyErr } = await supabase.from("editorial_plan_weekly_slots").insert(inserts);
    if (insWeeklyErr) {
      toast.error(insWeeklyErr.message);
      setSavingCode(null);
      return;
    }

    const { error: delSlotsErr } = await supabase
      .from("editorial_plan_slots")
      .delete()
      .eq("channel_id", d.channelId)
      .gte("slot_date", today)
      .eq("status", "open")
      .is("assigned_article_id", null);
    if (delSlotsErr) {
      toast.error(delSlotsErr.message);
      setSavingCode(null);
      return;
    }

    toast.success(`${EDITORIAL_CHANNEL_LABELS[code]}: impostazioni e template salvati.`);
    setSavingCode(null);
    await onSaved();
    await loadAll();
  };

  const saveOAuthMetadata = async (code: EditorialChannelCode) => {
    if (code === "site") return;
    const d = drafts[code];
    if (!d) return;

    setSavingOAuthCode(code);
    const row = {
      ...(d.oauthId ? { id: d.oauthId } : {}),
      channel_id: d.channelId,
      provider: d.oauthProvider || oauthProviderForChannel(code),
      account_label: d.oauthAccountLabel.trim() || null,
      scopes: d.oauthScopes.trim() || null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("social_oauth_connections").upsert(row, { onConflict: "channel_id" });
    if (error) {
      toast.error(error.message);
      setSavingOAuthCode(null);
      return;
    }

    toast.success(`${EDITORIAL_CHANNEL_LABELS[code]}: profilo social aggiornato.`);
    setSavingOAuthCode(null);
    await loadAll();
    await onSaved();
  };

  const removeOAuth = async (code: EditorialChannelCode) => {
    if (code === "site") return;
    const d = drafts[code];
    if (!d) return;

    setSavingOAuthCode(code);
    const { error } = await supabase.from("social_oauth_connections").delete().eq("channel_id", d.channelId);
    if (error) {
      toast.error(error.message);
      setSavingOAuthCode(null);
      return;
    }

    updateDraft(code, {
      oauthId: null,
      oauthProvider: oauthProviderForChannel(code),
      oauthAccountLabel: "",
      oauthScopes: "",
      oauthHasToken: false,
    });
    toast.success("Collegamento social rimosso.");
    setSavingOAuthCode(null);
    await loadAll();
    await onSaved();
  };

  const startPlatformOAuth = async (code: EditorialChannelCode, channelId: string) => {
    if (code === "site") return;
    const baseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
    if (!baseUrl || !anon) {
      toast.error("Manca VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY.");
      return;
    }

    setOauthRedirecting(code);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        toast.error("Sessione non valida: effettua di nuovo l’accesso.");
        setOauthRedirecting(null);
        return;
      }

      const fnUrl = `${baseUrl.replace(/\/$/, "")}/functions/v1/social-oauth-start?channel_id=${encodeURIComponent(channelId)}`;
      const res = await fetch(fnUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: anon,
        },
      });

      const raw = await res.text();
      let payload: {
        authorization_url?: string;
        error?: string;
        hint?: string;
        reason?: string;
        msg?: string;
      } = {};
      if (raw) {
        try {
          payload = JSON.parse(raw) as typeof payload;
        } catch {
          payload = {};
        }
      }

      if (!res.ok) {
        const msg =
          payload.error ||
          payload.reason ||
          payload.msg ||
          (raw && !raw.trim().startsWith("{") ? raw.trim().slice(0, 240) : "") ||
          res.statusText;
        const hint = payload.hint;
        toast.error(hint ? `${msg}: ${hint}` : msg || `Errore HTTP ${res.status}`);
        setOauthRedirecting(null);
        return;
      }

      if (!payload.authorization_url) {
        toast.error(
          raw && raw.length < 400
            ? `Risposta OAuth non valida: ${raw}`
            : "Risposta OAuth senza authorization_url (controlla che la function social-oauth-start sia deployata).",
        );
        setOauthRedirecting(null);
        return;
      }

      window.location.assign(payload.authorization_url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore di rete.");
      setOauthRedirecting(null);
    }
  };

  const accordionDefault = useMemo(() => [initialChannelCode], [initialChannelCode]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-hidden flex flex-col sm:rounded-[22px] border-stone-200/90 p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-3 shrink-0">
          <DialogTitle className="font-serif text-xl pr-8">Impostazioni piano editoriale</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
            Una sezione per ogni canale: mix, orizzonte, timezone e slot ricorrenti. Per i social puoi collegare l’account con OAuth (redirect
            sicuro) oppure salvare solo metadati (etichetta / provider).
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[220px] max-h-[calc(92vh-9.5rem)] overflow-y-auto overscroll-contain px-6 pb-4">
          {loading ? (
            <p className="text-sm text-muted-foreground animate-pulse py-6">Caricamento canali…</p>
          ) : (
            <Accordion
              key={openGeneration.current}
              type="multiple"
              defaultValue={accordionDefault}
              className="w-full"
            >
              {EDITORIAL_CHANNEL_ORDER.map((code) => {
                const d = drafts[code];
                const label = EDITORIAL_CHANNEL_LABELS[code];
                const formatOptions = code === "site" ? [] : contentFormatsForChannel(code);
                const oauthActive = Boolean(d?.oauthHasToken);
                const oauthMetaOnly = Boolean(
                  d && !d.oauthHasToken && (d.oauthId || (d.oauthAccountLabel && d.oauthAccountLabel.trim())),
                );
                const oauthLinked = oauthActive || oauthMetaOnly;
                const oauthSubhint = oauthLoginSubhint(code);

                if (!d) {
                  return (
                    <AccordionItem key={code} value={code} className="border-border/80">
                      <AccordionTrigger className="text-sm hover:no-underline py-3">{label}</AccordionTrigger>
                      <AccordionContent>
                        <p className="text-xs text-muted-foreground py-2">Canale non presente nel database. Applica la migration editoriale.</p>
                      </AccordionContent>
                    </AccordionItem>
                  );
                }

                return (
                  <AccordionItem key={code} value={code} className="border-border/80">
                    <AccordionTrigger className="text-sm hover:no-underline py-3">
                      <span className="flex items-center gap-2">
                        {label}
                        {code !== "site" && (
                          <span
                            className={cn(
                              "text-[10px] font-sans uppercase tracking-wider px-2 py-0.5 rounded-full",
                              oauthActive
                                ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
                                : oauthMetaOnly
                                  ? "bg-accent/20 text-accent"
                                  : "bg-muted text-muted-foreground",
                            )}
                          >
                            {oauthActive ? "OAuth attivo" : oauthMetaOnly ? "Solo metadati" : "Nessun profilo"}
                          </span>
                        )}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-5 text-sm pb-6">
                      {code !== "site" && (
                        <>
                          <div className="rounded-[16px] border border-border/80 bg-muted/20 p-4 space-y-3">
                            <div className="flex items-center gap-2 text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground">
                              <Link2 size={14} className="shrink-0" />
                              Accesso al profilo social
                            </div>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                              Per ogni canale social c’è un pulsante dedicato (es. «Accedi con Instagram»): ti porta sul sito del provider,
                              torni qui dopo l’autorizzazione e il token viene salvato solo lato server. Sotto puoi aggiungere o correggere
                              metadati (etichetta, note scope) se ti serve in admin.
                            </p>
                            <div className="flex flex-col gap-1.5">
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  className="gap-1"
                                  disabled={savingOAuthCode !== null || oauthRedirecting !== null}
                                  onClick={() => void startPlatformOAuth(code, d.channelId)}
                                >
                                  <LogIn size={14} />
                                  {oauthRedirecting === code ? "Reindirizzamento…" : oauthLoginButtonLabel(code)}
                                </Button>
                              </div>
                              {oauthSubhint ? (
                                <p className="text-[10px] text-muted-foreground leading-relaxed max-w-prose">{oauthSubhint}</p>
                              ) : null}
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div>
                                <label className="text-[10px] uppercase text-muted-foreground block mb-1">Provider API</label>
                                <select
                                  value={d.oauthProvider}
                                  onChange={(e) => updateDraft(code, { oauthProvider: e.target.value })}
                                  className="w-full rounded-[14px] border border-border bg-background/90 px-3 py-2 text-xs font-sans"
                                >
                                  {OAUTH_PROVIDER_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>
                                      {o.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="text-[10px] uppercase text-muted-foreground block mb-1">Nome / @ profilo</label>
                                <input
                                  value={d.oauthAccountLabel}
                                  onChange={(e) => updateDraft(code, { oauthAccountLabel: e.target.value })}
                                  placeholder="es. @biteproject o nome pagina"
                                  className="w-full rounded-[14px] border border-border bg-background/90 px-3 py-2 text-xs font-sans"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="text-[10px] uppercase text-muted-foreground block mb-1">Scope (opzionale, testo)</label>
                              <textarea
                                value={d.oauthScopes}
                                onChange={(e) => updateDraft(code, { oauthScopes: e.target.value })}
                                rows={2}
                                placeholder="Note sui permessi concessi…"
                                className="w-full rounded-[14px] border border-border bg-background/90 px-3 py-2 text-xs font-sans resize-none"
                              />
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                disabled={savingOAuthCode !== null || oauthRedirecting !== null}
                                onClick={() => void saveOAuthMetadata(code)}
                              >
                                {savingOAuthCode === code ? "Salvataggio…" : "Salva profilo social"}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="gap-1 text-destructive border-destructive/40 hover:bg-destructive/10"
                                disabled={savingOAuthCode !== null || oauthRedirecting !== null || !oauthLinked}
                                onClick={() => void removeOAuth(code)}
                              >
                                <Trash2 size={14} />
                                Rimuovi collegamento
                              </Button>
                            </div>
                            <p className="text-[10px] text-muted-foreground">
                              Dopo il login del provider tornerai alla dashboard admin; assicurati che le Edge Function e i secret OAuth siano
                              configurati su Supabase.
                            </p>
                          </div>
                          <Separator />
                        </>
                      )}

                      <div>
                        <label className="text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground block mb-1.5">
                          Pubblicazioni settimanali (numero righe sotto)
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={21}
                          value={d.slotRows.length}
                          onChange={(e) => {
                            const n = Math.min(21, Math.max(1, Number(e.target.value) || 1));
                            setDrafts((prev) => {
                              const cur = prev[code];
                              if (!cur) return prev;
                              let nextRows = cur.slotRows;
                              if (n === nextRows.length) return prev;
                              if (n > nextRows.length) {
                                const add = n - nextRows.length;
                                nextRows = [...nextRows, ...Array.from({ length: add }, () => emptySlotRow())];
                              } else {
                                nextRows = nextRows.slice(0, n);
                              }
                              return { ...prev, [code]: { ...cur, slotRows: nextRows } };
                            });
                          }}
                          className="w-full rounded-[14px] border border-border bg-background/80 px-3 py-2 font-sans"
                        />
                      </div>

                      <div>
                        <label className="text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground block mb-1.5">
                          Orizzonte calendario (settimane)
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={52}
                          value={d.horizonWeeks}
                          onChange={(e) =>
                            updateDraft(code, { horizonWeeks: Math.min(52, Math.max(1, Number(e.target.value) || 1)) })
                          }
                          className="w-full rounded-[14px] border border-border bg-background/80 px-3 py-2 font-sans"
                        />
                      </div>

                      <div>
                        <label className="text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground block mb-1.5">
                          Mix contenuti (%)
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <span className="text-[10px] text-muted-foreground">Pillar</span>
                            <input
                              type="number"
                              step={0.5}
                              value={d.mixPillar}
                              onChange={(e) => updateDraft(code, { mixPillar: Number(e.target.value) })}
                              className="w-full rounded-[14px] border border-border bg-background/80 px-2 py-1.5 font-sans"
                            />
                          </div>
                          <div>
                            <span className="text-[10px] text-muted-foreground">Support</span>
                            <input
                              type="number"
                              step={0.5}
                              value={d.mixSupport}
                              onChange={(e) => updateDraft(code, { mixSupport: Number(e.target.value) })}
                              className="w-full rounded-[14px] border border-border bg-background/80 px-2 py-1.5 font-sans"
                            />
                          </div>
                          <div>
                            <span className="text-[10px] text-muted-foreground">Utility</span>
                            <input
                              type="number"
                              step={0.5}
                              value={d.mixUtility}
                              onChange={(e) => updateDraft(code, { mixUtility: Number(e.target.value) })}
                              className="w-full rounded-[14px] border border-border bg-background/80 px-2 py-1.5 font-sans"
                            />
                          </div>
                        </div>
                        <p className="text-xs mt-1 text-muted-foreground">
                          Somma: {d.mixPillar + d.mixSupport + d.mixUtility}%
                        </p>
                      </div>

                      <div>
                        <label className="text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground block mb-1.5">
                          Timezone
                        </label>
                        <input
                          value={d.timezone}
                          onChange={(e) => updateDraft(code, { timezone: e.target.value })}
                          className="w-full rounded-[14px] border border-border bg-background/80 px-3 py-2 font-sans"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground">
                            Slot settimanali (giorno + ora{formatOptions.length ? " + formato" : ""})
                          </label>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setDrafts((prev) => {
                                const cur = prev[code];
                                if (!cur) return prev;
                                const nextRows = [...cur.slotRows, emptySlotRow()];
                                return { ...prev, [code]: { ...cur, slotRows: nextRows } };
                              })
                            }
                          >
                            + Slot
                          </Button>
                        </div>
                        <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                          {d.slotRows.map((row) => (
                            <div key={row.localKey} className="flex flex-wrap items-center gap-2">
                              <select
                                value={row.day_of_week}
                                onChange={(e) =>
                                  setSlotRowsFor(code, (prev) =>
                                    prev.map((r) =>
                                      r.localKey === row.localKey ? { ...r, day_of_week: Number(e.target.value) } : r
                                    )
                                  )
                                }
                                className="flex-1 min-w-[5.5rem] rounded-[14px] border border-border bg-background/80 px-2 py-1.5 font-sans text-xs"
                              >
                                {WEEKDAY_LABELS_IT.map((lbl, dow) => (
                                  <option key={dow} value={dow}>
                                    {lbl}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="time"
                                value={row.time_of_day.length > 5 ? row.time_of_day.slice(0, 5) : row.time_of_day}
                                onChange={(e) =>
                                  setSlotRowsFor(code, (prev) =>
                                    prev.map((r) => (r.localKey === row.localKey ? { ...r, time_of_day: e.target.value } : r))
                                  )
                                }
                                className="w-[7.5rem] rounded-[14px] border border-border bg-background/80 px-2 py-1.5 font-sans text-xs"
                              />
                              {formatOptions.length > 0 && (
                                <select
                                  value={row.content_format}
                                  onChange={(e) =>
                                    setSlotRowsFor(code, (prev) =>
                                      prev.map((r) =>
                                        r.localKey === row.localKey ? { ...r, content_format: e.target.value } : r
                                      )
                                    )
                                  }
                                  className="min-w-[7.5rem] flex-1 rounded-[14px] border border-border bg-background/80 px-2 py-1.5 font-sans text-xs"
                                >
                                  <option value="">Formato…</option>
                                  {formatOptions.map((o) => (
                                    <option key={o.value} value={o.value}>
                                      {o.label}
                                    </option>
                                  ))}
                                </select>
                              )}
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={d.slotRows.length <= 1}
                                onClick={() =>
                                  setDrafts((prev) => {
                                    const cur = prev[code];
                                    if (!cur || cur.slotRows.length <= 1) return prev;
                                    return {
                                      ...prev,
                                      [code]: {
                                        ...cur,
                                        slotRows: cur.slotRows.filter((r) => r.localKey !== row.localKey),
                                      },
                                    };
                                  })
                                }
                              >
                                Rimuovi
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>

                      <Button
                        type="button"
                        disabled={savingCode !== null || savingOAuthCode !== null || oauthRedirecting !== null}
                        onClick={() => void saveChannel(code)}
                        className="w-full sm:w-auto"
                      >
                        {savingCode === code ? "Salvataggio…" : `Salva impostazioni ${label}`}
                      </Button>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border/60 shrink-0 bg-muted/20">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Chiudi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
