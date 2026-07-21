import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Check, Loader2, Mail, RefreshCw, Wallet } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type UntypedSupabase = {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};
const rpcSupabase = supabase as unknown as UntypedSupabase;

type PendingRefundRow = {
  deposit_id: string;
  booking_request_id: string;
  voyage_id: string | null;
  voyage_name: string | null;
  voyage_name_it: string | null;
  voyage_name_en: string | null;
  traveller_name: string | null;
  traveller_email: string | null;
  amount_cents: number | null;
  pending_amount_cents: number | null;
  reason: string | null;
  environment: string | null;
  reference: string | null;
  payout_queued: boolean | null;
  account_holder: string | null;
  account_iban: string | null;
  updated_at: string | null;
};

const REASON_LABELS: Record<string, string> = {
  no_payer_alias: "Nessun conto/IBAN registrato per il pagatore",
  no_monetary_account: "IBAN non collegato a un conto Bunq",
  payout_failed: "Bonifico non riuscito (es. fondi insufficienti) — da rieseguire",
};

function formatEur(cents: number | null | undefined): string {
  const value = Math.max(0, Number(cents ?? 0) || 0) / 100;
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(value);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function voyageLabel(row: PendingRefundRow): string {
  return row.voyage_name_it || row.voyage_name || row.voyage_name_en || "Viaggio";
}

export default function AdminBookingRefunds() {
  const [rows, setRows] = useState<PendingRefundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await rpcSupabase.rpc("admin_list_pending_refunds");
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows((data as PendingRefundRow[]) ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totalCents = useMemo(
    () => rows.reduce((sum, row) => sum + (Number(row.pending_amount_cents ?? 0) || 0), 0),
    [rows],
  );

  const retryPayout = async (row: PendingRefundRow) => {
    setResolvingId(row.deposit_id);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setResolvingId(null);
      toast.error("Sessione scaduta: accedi di nuovo.");
      return;
    }

    let response: Response;
    try {
      response = await fetch("/api/bookings/refund-retry", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ depositId: row.deposit_id }),
      });
    } catch {
      setResolvingId(null);
      toast.error("Rete non raggiungibile. Riprova.");
      return;
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = (await response.json()) as Record<string, unknown>;
    } catch {
      /* ignore malformed body */
    }
    setResolvingId(null);

    if (!response.ok || payload.ok !== true) {
      toast.error(`Rimborso non riuscito: ${String(payload.error ?? `http_${response.status}`)}`);
      return;
    }
    toast.success(`Rimborso eseguito: ${formatEur(Math.round(Number(payload.amountEur ?? 0) * 100))}.`);
    setRows((current) => current.filter((item) => item.deposit_id !== row.deposit_id));
  };

  const resolve = async (row: PendingRefundRow) => {
    if (!confirm(`Confermi di aver rimborsato manualmente ${formatEur(row.pending_amount_cents)} a ${row.traveller_name || row.traveller_email || "questo utente"}?`)) {
      return;
    }
    setResolvingId(row.deposit_id);
    const { error } = await rpcSupabase.rpc("admin_resolve_pending_refund", { _deposit_id: row.deposit_id });
    setResolvingId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Rimborso segnato come eseguito.");
    setRows((current) => current.filter((item) => item.deposit_id !== row.deposit_id));
  };

  return (
    <div className="min-h-screen px-5 pb-16 pt-24 md:px-10">
      <div className="mx-auto max-w-[80rem] space-y-6">
        <section className="glass-panel rounded-[34px] px-6 py-8 md:px-9">
          <Link
            to="/admin/bookings"
            className="glass-chip mb-6 inline-flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={14} /> Torna al Booking control room
          </Link>
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h1 className="editorial-heading flex items-center gap-3 text-4xl md:text-5xl">
                <Wallet className="opacity-70" size={34} /> Rimborsi da eseguire
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Candidature scartate o annullate per cui il riaccredito automatico non è andato a buon fine (nessun
                IBAN disponibile). All'utente è stato chiesto via email di comunicare l'IBAN: appena arriva, esegui il
                bonifico e segna qui il rimborso come completato.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="glass-chip rounded-2xl px-4 py-2 text-sm">
                <span className="text-muted-foreground">Totale in sospeso: </span>
                <span className="font-semibold">{formatEur(totalCents)}</span>
              </div>
              <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
                {loading ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
                <span className="ml-2">Aggiorna</span>
              </Button>
            </div>
          </div>
        </section>

        <section className="glass-panel rounded-[34px] px-6 py-6 md:px-9">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="animate-spin" size={18} /> Caricamento…
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
              <Check size={26} className="opacity-60" />
              <p className="text-sm">Nessun rimborso in sospeso. Tutto in ordine.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {rows.map((row) => (
                <li
                  key={row.deposit_id}
                  className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-background/40 p-5 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{row.traveller_name || "Senza nome"}</span>
                      <span
                        className={
                          row.payout_queued
                            ? "rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-600"
                            : "rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-600"
                        }
                      >
                        {row.payout_queued ? "Da rieseguire" : "Attende IBAN"}
                      </span>
                      {row.environment && row.environment !== "production" ? (
                        <span className="glass-chip rounded-full px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                          {row.environment}
                        </span>
                      ) : null}
                    </div>
                    {row.traveller_email ? (
                      <a
                        href={`mailto:${row.traveller_email}?subject=${encodeURIComponent(`Rimborso quota — ${voyageLabel(row)}`)}`}
                        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                      >
                        <Mail size={13} /> {row.traveller_email}
                      </a>
                    ) : (
                      <p className="text-sm text-muted-foreground">Email non disponibile</p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      {voyageLabel(row)} · {REASON_LABELS[row.reason ?? ""] || row.reason || "Motivo non specificato"}
                    </p>
                    {row.account_iban ? (
                      <p className="text-sm text-muted-foreground">
                        Coordinate fornite: <span className="font-medium text-foreground/80">{row.account_holder || "—"}</span>{" "}
                        · <span className="font-mono">{row.account_iban}</span>
                      </p>
                    ) : null}
                    <p className="text-xs text-muted-foreground/80">
                      Causale pagamento: <span className="font-mono">{row.reference || "—"}</span> · aggiornato {formatDate(row.updated_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 md:flex-col md:items-end">
                    <span className="text-lg font-semibold">{formatEur(row.pending_amount_cents)}</span>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {row.payout_queued ? (
                        <Button
                          size="sm"
                          onClick={() => void retryPayout(row)}
                          disabled={resolvingId === row.deposit_id}
                        >
                          {resolvingId === row.deposit_id ? (
                            <Loader2 className="animate-spin" size={14} />
                          ) : (
                            <RefreshCw size={14} />
                          )}
                          <span className="ml-2">Riesegui rimborso</span>
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant={row.payout_queued ? "outline" : "default"}
                        onClick={() => void resolve(row)}
                        disabled={resolvingId === row.deposit_id}
                      >
                        {resolvingId === row.deposit_id ? (
                          <Loader2 className="animate-spin" size={14} />
                        ) : (
                          <Check size={14} />
                        )}
                        <span className="ml-2">Segna rimborsato</span>
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
