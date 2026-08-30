import type { Dispatch, SetStateAction } from "react";
import { X, Loader2 } from "lucide-react";
import { slugifyVoyageName, type Voyage } from "@/lib/voyage-utils";
import { contributionFixedMinimumEur, formatDepositEur } from "@/lib/booking-deposit";
import type { VoyageFormState } from "@/components/admin/AdminVoyageManager";

const voyageStatusLabels: Record<Voyage["status"], string> = {
  planned: "Planned",
  active: "Active",
  completed: "Completed",
};

const popupLanguageOptions = [
  { code: "it", label: "Italiano" },
  { code: "en", label: "English" },
] as const;

export interface VoyageFormPanelProps {
  voyageForm: VoyageFormState;
  setVoyageForm: Dispatch<SetStateAction<VoyageFormState>>;
  voyageFormLang: "it" | "en";
  setVoyageFormLang: Dispatch<SetStateAction<"it" | "en">>;
  editingVoyage: Voyage | null;
  estimatedVoyageArrival: { date: string; time: string } | null;
  closeVoyageForm: () => void;
  saveVoyage: () => void;
  isSavingVoyage: boolean;
}

const VoyageFormPanel = ({
  voyageForm,
  setVoyageForm,
  voyageFormLang,
  setVoyageFormLang,
  editingVoyage,
  estimatedVoyageArrival,
  closeVoyageForm,
  saveVoyage,
  isSavingVoyage,
}: VoyageFormPanelProps) => {
  const voyageFormStatus = voyageForm.status_override || voyageForm.status;

  return (
    <div className="border border-border p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-sans font-medium">{editingVoyage ? "Edit Voyage" : "New Voyage"}</h4>
        <button onClick={closeVoyageForm} className="text-muted-foreground hover:text-foreground">
          <X size={16} />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <p className="text-[10px] font-sans font-semibold uppercase tracking-[0.14em] text-muted-foreground">Testi viaggio</p>
          <div className="flex gap-1.5 rounded-[14px] border border-border p-1 bg-muted/30">
            {popupLanguageOptions.map(({ code, label }) => (
              <button
                key={`voyage-lang-${code}`}
                type="button"
                onClick={() => setVoyageFormLang(code)}
                className={`flex-1 rounded-[10px] px-3 py-2 text-xs font-sans font-semibold transition-colors ${
                  voyageFormLang === code
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {voyageFormLang === "it" ? (
            <>
              <div>
                <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Nome</label>
                <input
                  type="text"
                  value={voyageForm.name_it}
                  onChange={(event) => {
                    const value = event.target.value;
                    setVoyageForm((form) => ({
                      ...form,
                      name_it: value,
                      slug_it: !editingVoyage || !form.slug_it ? slugifyVoyageName(value) : form.slug_it,
                      slug: !editingVoyage || !form.slug ? slugifyVoyageName(form.name_en || value) : form.slug,
                    }));
                  }}
                  className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                />
              </div>
              <div>
                <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Slug IT</label>
                <input
                  type="text"
                  value={voyageForm.slug_it}
                  onChange={(event) => setVoyageForm((form) => ({ ...form, slug_it: event.target.value }))}
                  placeholder="es. giro-di-sicilia"
                  className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                />
                <p className="mt-1 text-[10px] text-muted-foreground">URL pubblico in /it/voyages/. Lascia vuoto per usare lo slug canonico.</p>
              </div>
              <div>
                <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Descrizione</label>
                <textarea
                  value={voyageForm.description_it}
                  onChange={(event) => setVoyageForm((form) => ({ ...form, description_it: event.target.value }))}
                  rows={3}
                  className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent resize-none"
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Name</label>
                <input
                  type="text"
                  value={voyageForm.name_en}
                  onChange={(event) => {
                    const value = event.target.value;
                    setVoyageForm((form) => ({
                      ...form,
                      name_en: value,
                      slug_en: !editingVoyage || !form.slug_en ? slugifyVoyageName(value) : form.slug_en,
                      slug: !editingVoyage || !form.slug ? slugifyVoyageName(value || form.name_it) : form.slug,
                    }));
                  }}
                  className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                />
              </div>
              <div>
                <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Slug EN</label>
                <input
                  type="text"
                  value={voyageForm.slug_en}
                  onChange={(event) => setVoyageForm((form) => ({ ...form, slug_en: event.target.value }))}
                  placeholder="e.g. sicily-loop"
                  className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                />
                <p className="mt-1 text-[10px] text-muted-foreground">Public URL under /en/voyages/. Leave empty to fall back to the canonical slug.</p>
              </div>
              <div>
                <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Description</label>
                <textarea
                  value={voyageForm.description_en}
                  onChange={(event) => setVoyageForm((form) => ({ ...form, description_en: event.target.value }))}
                  rows={3}
                  className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent resize-none"
                />
              </div>
            </>
          )}
          <div>
            <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Slug (canonico / fallback)</label>
            <input
              type="text"
              value={voyageForm.slug}
              onChange={(event) => setVoyageForm((form) => ({ ...form, slug: event.target.value }))}
              className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              URL legacy / fallback quando manca lo slug per la lingua. Deve essere unico.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Type</label>
            <select
              value={voyageForm.type}
              onChange={(event) => {
                const nextType = event.target.value as Voyage["type"];
                setVoyageForm((form) => ({
                  ...form,
                  type: nextType,
                  waterway_autoroute: nextType === "land" ? false : form.waterway_autoroute,
                }));
              }}
              className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
            >
              <option value="water">🚢 Water</option>
              <option value="land">🚐 Land</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Status</label>
            <select
              value={voyageForm.status_override}
              onChange={(event) =>
                setVoyageForm((form) => {
                  const nextOverride = event.target.value as VoyageFormState["status_override"];
                  const effective = nextOverride || form.status;
                  return {
                    ...form,
                    status_override: nextOverride,
                    dates_tbd: effective === "planned" ? form.dates_tbd : false,
                  };
                })
              }
              className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
            >
              <option value="">Automatico — {voyageStatusLabels[voyageForm.status]}</option>
              <option value="planned">Forza Planned</option>
              <option value="active">Forza Active</option>
              <option value="completed">Forza Completed</option>
            </select>
            <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">
              {voyageForm.status_override
                ? "Stato forzato a mano: resta questo finche non torni su Automatico."
                : "Derivato da date effettive e previste: passato = concluso, in corso = attivo, futuro = programmato."}
            </p>
          </div>
        </div>

        {voyageForm.type === "water" && (
          <div className="rounded-[20px] border border-border px-4 py-3">
            <span className="block text-xs font-sans uppercase tracking-[0.2em] text-foreground">
              Tipo di navigazione
            </span>
            <div
              role="radiogroup"
              aria-label="Tipo di navigazione"
              className="mt-3 grid grid-cols-2 gap-1 rounded-[14px] border border-border bg-muted/30 p-1"
            >
              {([
                {
                  value: false,
                  label: "Mare",
                  hint: "Rotta in alto mare: la linea segue i waypoint in linea retta.",
                },
                {
                  value: true,
                  label: "Canali · fiumi",
                  hint: "Autoroute su vie navigabili (OpenStreetMap via BRouter): la linea segue canali e fiumi tra i waypoint.",
                },
              ] as const).map((option) => {
                const active = voyageForm.waterway_autoroute === option.value;
                return (
                  <button
                    key={option.label}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() =>
                      setVoyageForm((form) => ({ ...form, waterway_autoroute: option.value }))
                    }
                    className={`rounded-[10px] px-3 py-2 text-xs font-sans uppercase tracking-[0.16em] transition-colors ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <span className="mt-2 block text-[11px] font-sans text-muted-foreground">
              {voyageForm.waterway_autoroute
                ? "Autoroute su vie navigabili: i waypoint devono essere vicini all’asse del canale/fiume; dove non c’è grafo utile quel tratto resta in linea retta. Sul sito resta un voyage acqua come gli altri."
                : "Alto mare: nessun instradamento, la rotta collega i waypoint in linea retta."}
            </span>
          </div>
        )}

        <label className="flex items-start gap-3 rounded-[20px] border border-border px-4 py-3">
          <input
            type="checkbox"
            checked={voyageForm.is_published}
            onChange={(event) => setVoyageForm((form) => ({ ...form, is_published: event.target.checked }))}
            className="mt-0.5 h-4 w-4 accent-[hsl(var(--accent))]"
          />
          <span className="min-w-0">
            <span className="block text-xs font-sans uppercase tracking-[0.2em] text-foreground">
              {voyageForm.is_published ? "Published route" : "Draft route"}
            </span>
            <span className="mt-1 block text-[11px] font-sans text-muted-foreground">
              {voyageForm.is_published
                ? "Visible on public maps and route pages."
                : "Hidden from public maps and route pages until published."}
            </span>
          </span>
        </label>

        <div className="rounded-[20px] border border-border px-4 py-3">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={voyageForm.booking_enabled}
              onChange={(event) =>
                setVoyageForm((form) => ({ ...form, booking_enabled: event.target.checked }))
              }
              className="mt-0.5 h-4 w-4 accent-[hsl(var(--accent))]"
            />
            <span className="min-w-0">
              <span className="block text-xs font-sans uppercase tracking-[0.2em] text-foreground">
                {voyageForm.booking_enabled ? "Booking aperto" : "Booking disattivato"}
              </span>
              <span className="mt-1 block text-[11px] font-sans text-muted-foreground">
                Consente agli utenti registrati di richiedere imbarco sulle tratte pubbliche del viaggio.
              </span>
            </span>
          </label>
          {voyageForm.booking_enabled && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">
                  Persone max
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={voyageForm.booking_max_guests}
                  onChange={(event) =>
                    setVoyageForm((form) => ({ ...form, booking_max_guests: event.target.value }))
                  }
                  className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">
                  Velocità kn
                </label>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={voyageForm.booking_planning_speed_kn}
                  onChange={(event) =>
                    setVoyageForm((form) => ({ ...form, booking_planning_speed_kn: event.target.value }))
                  }
                  className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">
                  €/NM contributo
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={voyageForm.booking_contribution_per_nm_eur}
                  onChange={(event) =>
                    setVoyageForm((form) => ({ ...form, booking_contribution_per_nm_eur: event.target.value }))
                  }
                  className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
                />
                <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">
                  Default 0,90 euro per miglio nautico pianificato.
                </p>
              </div>
              <div>
                <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">
                  Quota fissa minima
                </label>
                <div className="w-full border border-dashed border-border px-3 py-2 text-sm font-sans text-foreground">
                  {formatDepositEur(contributionFixedMinimumEur())}
                </div>
                <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">
                  Valore fisso di sito, uguale per tutti i viaggi: si aggiunge una volta per persona al contributo
                  calcolato sulle miglia.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <label className="flex items-start gap-3 rounded-[20px] border border-border px-4 py-3">
        <input
          type="checkbox"
          checked={voyageForm.dates_tbd}
          disabled={voyageFormStatus !== "planned"}
          onChange={(event) =>
            setVoyageForm((form) => ({
              ...form,
              dates_tbd: event.target.checked,
              ...(event.target.checked
                ? {
                    start_date: "",
                    start_time: "",
                    start_date_flex_days: "0",
                    end_date: "",
                    end_time: "",
                    end_date_flex_days: "0",
                  }
                : {}),
            }))
          }
          className="mt-0.5 h-4 w-4 accent-[hsl(var(--accent))] disabled:opacity-50"
        />
        <span className="min-w-0">
          <span className="block text-xs font-sans uppercase tracking-[0.2em] text-foreground">
            Date da definirsi
          </span>
          <span className="mt-1 block text-[11px] font-sans text-muted-foreground">
            {voyageFormStatus === "planned"
              ? "Usalo per viaggi desiderati ma non ancora calendarizzati. Salva il viaggio senza date fissate."
              : "Disponibile solo per viaggi con stato Planned."}
          </span>
        </span>
      </label>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground block">Start</label>
          <div className="grid grid-cols-[1fr_140px] gap-3">
            <input
              type="date"
              value={voyageForm.start_date}
              disabled={voyageForm.dates_tbd}
              onChange={(event) =>
                setVoyageForm((form) => ({
                  ...form,
                  dates_tbd: false,
                  start_date: event.target.value,
                }))
              }
              className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent disabled:opacity-50"
            />
            <input
              type="time"
              value={voyageForm.start_time}
              disabled={voyageForm.dates_tbd}
              onChange={(event) =>
                setVoyageForm((form) => ({
                  ...form,
                  dates_tbd: false,
                  start_time: event.target.value,
                }))
              }
              className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent disabled:opacity-50"
            />
          </div>
          {voyageFormStatus === "planned" && !voyageForm.dates_tbd && (
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <div className="text-[11px] font-sans text-muted-foreground flex items-center">
                Finestra partenza
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">±</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={voyageForm.start_date_flex_days}
                  onChange={(event) =>
                    setVoyageForm((form) => ({
                      ...form,
                      start_date_flex_days: event.target.value,
                    }))
                  }
                  className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
                />
              </div>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground font-sans">
            {voyageForm.dates_tbd
              ? "Date e orario verranno definiti più avanti."
              : voyageFormStatus === "planned"
                ? "Per i viaggi planned puoi indicare anche una flessibilità di ± giorni."
                : "Time is optional."}
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground block">
            End · arrivo stimato
          </label>
          <div className="grid grid-cols-[1fr_140px] gap-3">
            <input
              type="date"
              value={voyageForm.end_date}
              disabled={voyageForm.dates_tbd}
              onChange={(event) =>
                setVoyageForm((form) => ({
                  ...form,
                  dates_tbd: false,
                  end_date: event.target.value,
                }))
              }
              className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent disabled:opacity-50"
            />
            <input
              type="time"
              value={voyageForm.end_time}
              disabled={voyageForm.dates_tbd}
              onChange={(event) =>
                setVoyageForm((form) => ({
                  ...form,
                  dates_tbd: false,
                  end_time: event.target.value,
                }))
              }
              className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent disabled:opacity-50"
            />
          </div>
          {voyageFormStatus === "planned" && !voyageForm.dates_tbd && (
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <div className="text-[11px] font-sans text-muted-foreground flex items-center">
                Finestra arrivo
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">±</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={voyageForm.end_date_flex_days}
                  onChange={(event) =>
                    setVoyageForm((form) => ({
                      ...form,
                      end_date_flex_days: event.target.value,
                    }))
                  }
                  className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
                />
              </div>
            </div>
          )}
          {!voyageForm.dates_tbd && estimatedVoyageArrival && (
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-sans text-muted-foreground">
              <span>
                Arrivo stimato all&apos;ultima tappa:{" "}
                <span className="text-foreground">
                  {estimatedVoyageArrival.date} · {estimatedVoyageArrival.time}
                </span>{" "}
                (a {Number(voyageForm.booking_planning_speed_kn) || 5} kn + soste)
              </span>
              {(voyageForm.end_date !== estimatedVoyageArrival.date ||
                voyageForm.end_time !== estimatedVoyageArrival.time) && (
                <button
                  type="button"
                  onClick={() =>
                    setVoyageForm((form) => ({
                      ...form,
                      dates_tbd: false,
                      end_date: estimatedVoyageArrival.date,
                      end_time: estimatedVoyageArrival.time,
                    }))
                  }
                  className="rounded-[8px] border border-border px-2 py-1 text-[10.5px] uppercase tracking-[0.14em] text-foreground transition-colors hover:bg-muted"
                >
                  Usa stima
                </button>
              )}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground font-sans">
            {voyageForm.dates_tbd
              ? "Anche la finestra di arrivo resta aperta finché non viene pianificata."
              : estimatedVoyageArrival
                ? "Se il viaggio ha un piano, l'arrivo lo decide la finestra dell'ultima tratta: quello che scrivi qui viene riallineato al prossimo ricalcolo. Qui vale a mano solo finché non ci sono tratte."
                : voyageFormStatus === "planned"
                  ? "Usa ± giorni per rappresentare una finestra flessibile."
                  : "Leave blank if the arrival is still open."}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={saveVoyage}
        disabled={isSavingVoyage}
        aria-busy={isSavingVoyage}
        className="bg-primary text-primary-foreground px-5 py-2 text-sm font-sans font-medium hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2"
      >
        {isSavingVoyage ? <Loader2 size={14} className="animate-spin shrink-0" /> : null}
        {isSavingVoyage ? "Salvataggio…" : editingVoyage ? "Update" : "Create"}
      </button>
    </div>
  );
};

export default VoyageFormPanel;
