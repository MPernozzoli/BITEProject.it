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

type ForfeitedDepositRow = {
  deposit_id: string;
  booking_request_id: string;
  voyage_id: string | null;
  voyage_name: string | null;
  voyage_name_it: string | null;
  voyage_name_en: string | null;
  traveller_name: string | null;
  traveller_email: string | null;
  amount_cents: number | null;
  refund_amount_cents: number | null;
  environment: string | null;
  reference: string | null;
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

type RefundDepositResult = { ok: boolean; error: string; amountEur: number; needsIban: boolean };

async function callRefundDeposit(depositId: string, percentOverride?: number): Promise<RefundDepositResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { ok: false, error: "Sessione scaduta: accedi di nuovo.", amountEur: 0, needsIban: false };

  let response: Response;
  try {
    response = await fetch("/api/bookings/refund-deposit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ depositId, percentOverride }),
    });
  } catch {
    return { ok: false, error: "Rete non raggiungibile. Riprova.", amountEur: 0, needsIban: false };
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    /* ignore malformed body */
  }
  if (!response.ok || payload.ok !== true) {
    return {
      ok: false,
      error: String(payload.error ?? `http_${response.status}`),
      amountEur: 0,
      needsIban: false,
    };
  }
  return {
    ok: true,
    error: "",
    amountEur: Number(payload.amountEur ?? 0),
    needsIban: payload.needsIban === true,
  };
}

export default function AdminBookingRefunds() {
  const [rows, setRows] = useState<PendingRefundRow[]>([]);
  const [forfeited, setForfeited] = useState<ForfeitedDepositRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [overridePercent, setOverridePercent] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [pending, forfeitedResult] = await Promise.all([
      rpcSupabase.rpc("admin_list_pending_refunds"),
      rpcSupabase.rpc("admin_list_forfeited_deposits"),
    ]);
    setLoading(false);
    if (pending.error) {
      toast.error(pending.error.message);
    } else {
      setRows((pending.data as PendingRefundRow[]) ?? []);
    }
    if (forfeitedResult.error) {
      toast.error(forfeitedResult.error.message);
    } else {
      setForfeited((forfeitedResult.data as ForfeitedDepositRow[]) ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totalCents = useMemo(
    () => rows.reduce((sum, row) => sum + (Number(row.pending_amount_cents ?? 0) || 0), 0),
    [rows],
  );

  const tryAutomaticPayout = async (row: PendingRefundRow) => {
    setResolvingId(row.deposit_id);
    const result = await callRefundDeposit(row.deposit_id);
    setResolvingId(null);
    if (!result.ok) {
      toast.error(`Pagamento automatico non riuscito: ${result.error}`);
      return;
    }
    if (result.needsIban || result.amountEur <= 0) {
      toast.info("Nessun conto trovato per il pagatore: resta in attesa dell'IBAN.");
      return;
    }
    toast.success(`Rimborso eseguito: ${formatEur(Math.round(result.amountEur * 100))}.`);
    setRows((current) => current.filter((item) => item.deposit_id !== row.deposit_id));
  };

  const refundForfeited = async (row: ForfeitedDepositRow) => {
    const raw = overridePercent[row.deposit_id] ?? "100";
    const percent = Number(raw);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      toast.error("Indica una percentuale tra 1 e 100.");
      return;
    }
    if (
      !confirm(
        `Confermi il rimborso discrezionale del ${percent}% (${formatEur(
          Math.round(((row.amount_cents ?? 0) * percent) / 100),
        )}) a ${row.traveller_name || row.traveller_email || "questo utente"}?`,
      )
    ) {
      return;
    }
    setResolvingId(row.deposit_id);
    const result = await callRefundDeposit(row.deposit_id, percent);
    setResolvingId(null);
    if (!result.ok) {
      toast.error(`Rimborso non riuscito: ${result.error}`);
      return;
    }
    if (result.needsIban || result.amountEur <= 0) {
      toast.info("Nessun conto trovato per il pagatore: spostato nella coda 'attende IBAN'.");
      await load();
      return;
    }
    toast.success(`Rimborso eseguito: ${formatEur(Math.round(result.amountEur * 100))}.`);
    setForfeited((current) => current.filter((item) => item.deposit_id !== row.deposit_id));
  };

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
                            ? "rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-600 dark:text-sky-300"
                            : "rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-300"
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
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void tryAutomaticPayout(row)}
                          disabled={resolvingId === row.deposit_id}
                        >
                          {resolvingId === row.deposit_id ? (
                            <Loader2 className="animate-spin" size={14} />
                          ) : (
                            <RefreshCw size={14} />
                          )}
                          <span className="ml-2">Prova pagamento automatico</span>
                        </Button>
                      )}
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

        <section className="glass-panel rounded-[34px] px-6 py-8 md:px-9">
          <h2 className="editorial-heading text-2xl md:text-3xl">Acconti trattenuti per mancato saldo</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Prenotazioni (o singole partecipazioni) decadute perché il saldo non è arrivato entro la scadenza:
            l'acconto è trattenuto per policy, ma puoi comunque rimborsarlo in tutto o in parte a tua discrezione.
          </p>
          {!loading && forfeited.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
              <Check size={26} className="opacity-60" />
              <p className="text-sm">Nessun acconto trattenuto al momento.</p>
            </div>
          ) : (
            <ul className="mt-5 space-y-3">
              {forfeited.map((row) => (
                <li
                  key={row.deposit_id}
                  className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-background/40 p-5 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{row.traveller_name || "Senza nome"}</span>
                      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-600 dark:text-red-300">
                        Trattenuto
                      </span>
                      {row.environment && row.environment !== "production" ? (
                        <span className="glass-chip rounded-full px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                          {row.environment}
                        </span>
                      ) : null}
                    </div>
                    {row.traveller_email ? (
                      <a
                        href={`mailto:${row.traveller_email}`}
                        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                      >
                        <Mail size={13} /> {row.traveller_email}
                      </a>
                    ) : (
                      <p className="text-sm text-muted-foreground">Email non disponibile</p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      {row.voyage_name_it || row.voyage_name || row.voyage_name_en || "Viaggio"}
                    </p>
                    <p className="text-xs text-muted-foreground/80">
                      Causale: <span className="font-mono">{row.reference || "—"}</span> · aggiornato {formatDate(row.updated_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 md:flex-col md:items-end">
                    <span className="text-lg font-semibold">{formatEur(row.amount_cents)}</span>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <div className="flex items-center gap-1 text-sm">
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={overridePercent[row.deposit_id] ?? "100"}
                          onChange={(event) =>
                            setOverridePercent((current) => ({ ...current, [row.deposit_id]: event.target.value }))
                          }
                          className="w-16 rounded-md border border-border/60 bg-background/60 px-2 py-1 text-right text-sm"
                        />
                        <span className="text-muted-foreground">%</span>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => void refundForfeited(row)}
                        disabled={resolvingId === row.deposit_id}
                      >
                        {resolvingId === row.deposit_id ? (
                          <Loader2 className="animate-spin" size={14} />
                        ) : (
                          <Wallet size={14} />
                        )}
                        <span className="ml-2">Rimborsa</span>
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
