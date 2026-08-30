import type { Dispatch, SetStateAction } from "react";
import { Link } from "react-router-dom";
import { Check, Loader2, Plus, Settings, Wallet } from "lucide-react";
import type { BookingSettings, WorkawayRole } from "@/lib/booking-utils";

export interface VoyageWorkawaySettingsPanelProps {
  bookingSettings: BookingSettings;
  updateSettingsField: (
    field: keyof BookingSettings,
    value: string | number | boolean | string[],
  ) => void;
  isBookingSettingsDirty: boolean;
  saving: boolean;
  selectedVoyageId: string;
  saveBookingSettings: () => Promise<unknown>;
  workawayRoles: WorkawayRole[];
  newWorkawayRoleLabelIt: string;
  setNewWorkawayRoleLabelIt: Dispatch<SetStateAction<string>>;
  newWorkawayRoleLabelEn: string;
  setNewWorkawayRoleLabelEn: Dispatch<SetStateAction<string>>;
  addWorkawayRole: () => Promise<unknown>;
  toggleWorkawayRoleActive: (role: WorkawayRole) => Promise<unknown>;
  toggleVoyageWorkawayRoleKey: (key: string) => void;
}

const VoyageWorkawaySettingsPanel = ({
  bookingSettings,
  updateSettingsField,
  isBookingSettingsDirty,
  saving,
  selectedVoyageId,
  saveBookingSettings,
  workawayRoles,
  newWorkawayRoleLabelIt,
  setNewWorkawayRoleLabelIt,
  newWorkawayRoleLabelEn,
  setNewWorkawayRoleLabelEn,
  addWorkawayRole,
  toggleWorkawayRoleActive,
  toggleVoyageWorkawayRoleKey,
}: VoyageWorkawaySettingsPanelProps) => {
  return (
    <>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <Settings size={17} className="text-accent" />
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Impostazioni candidature</p>
              <h2 className="editorial-heading text-xl">Contributo alternativo &amp; workaway</h2>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isBookingSettingsDirty && (
              <span className="rounded-full border border-amber-300/70 dark:border-amber-500/30 bg-amber-100/70 dark:bg-amber-500/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-800 dark:text-amber-300">
                Modifiche non salvate
              </span>
            )}
            <button
              type="button"
              onClick={() => void saveBookingSettings()}
              disabled={saving || !selectedVoyageId}
              className="glass-chip inline-flex items-center justify-center gap-2 px-4 py-2 text-sm text-foreground hover:text-accent disabled:opacity-50"
            >
              {saving ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />}
              Salva
            </button>
            <Link
              to="/admin/bookings/rimborsi"
              className="glass-chip inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <Wallet size={14} /> Rimborsi da eseguire
            </Link>
          </div>
        </div>

        <div className="mb-6 rounded-[22px] border border-border/70 bg-background/35 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-border/70 bg-background/50 p-3">
              <span className="text-sm font-medium text-foreground">Proposta economica alternativa</span>
              <p className="mt-1 text-xs text-muted-foreground">
                Sempre attiva, su tutti i viaggi: il candidato può proporre un contributo totale diverso da quello
                calcolato. Il minimo di €20 (fisso) è sempre dovuto e non è configurabile. Qui puoi solo regolare il
                tetto massimo proponibile.
              </p>
              <div className="mt-3 flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Tetto massimo: fino al</span>
                <input
                  type="number"
                  min={100}
                  value={bookingSettings.contribution_proposal_max_percent}
                  onChange={(event) =>
                    updateSettingsField("contribution_proposal_max_percent", Number(event.target.value))
                  }
                  className="w-16 border border-border bg-background/70 px-2 py-1 text-xs focus:border-accent focus:outline-none"
                />
                <span className="text-muted-foreground">% del totale normalmente calcolato</span>
              </div>
            </div>

            <div className="rounded-2xl border border-border/70 bg-background/50 p-3">
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-foreground">Workaway attivo</span>
                <input
                  type="checkbox"
                  checked={bookingSettings.workaway_enabled}
                  onChange={(event) => updateSettingsField("workaway_enabled", event.target.checked)}
                  className="h-4 w-4"
                />
              </label>
              <p className="mt-1 text-xs text-muted-foreground">
                Permette candidature con mansioni (social, foto, video, cucina, skipper...) invece del contributo, per questo viaggio.
              </p>
            </div>
          </div>

          {bookingSettings.workaway_enabled && (
            <div className="mt-4">
              <p className="mb-2 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                Posizioni attive per questo viaggio
              </p>
              {workawayRoles.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nessun ruolo nel catalogo. Aggiungine uno qui sotto.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {workawayRoles.map((role) => {
                    const active = (bookingSettings.workaway_role_keys || []).includes(role.key);
                    return (
                      <button
                        key={role.id}
                        type="button"
                        onClick={() => toggleVoyageWorkawayRoleKey(role.key)}
                        aria-pressed={active}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          active
                            ? "border-accent bg-accent/10 text-foreground"
                            : "border-border/70 bg-background/40 text-muted-foreground hover:border-accent/50"
                        } ${role.active ? "" : "opacity-50"}`}
                        title={role.active ? undefined : "Ruolo disattivato dal catalogo globale"}
                      >
                        {role.label_it}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="mt-4 border-t border-border/60 pt-4">
            <p className="mb-2 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Catalogo ruoli workaway (globale, condiviso tra tutti i viaggi)
            </p>
            <div className="flex flex-wrap gap-1.5">
              {workawayRoles.map((role) => (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => void toggleWorkawayRoleActive(role)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    role.active
                      ? "border-emerald-300/70 dark:border-emerald-500/30 bg-emerald-100/60 dark:bg-emerald-500/15 text-emerald-900 dark:text-emerald-300"
                      : "border-border/70 bg-background/40 text-muted-foreground line-through"
                  }`}
                  title={role.active ? "Clicca per disattivare globalmente" : "Clicca per riattivare globalmente"}
                >
                  {role.label_it}
                </button>
              ))}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <input
                value={newWorkawayRoleLabelIt}
                onChange={(event) => setNewWorkawayRoleLabelIt(event.target.value)}
                placeholder="Nome ruolo IT (es. Cuoco)"
                className="border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
              <input
                value={newWorkawayRoleLabelEn}
                onChange={(event) => setNewWorkawayRoleLabelEn(event.target.value)}
                placeholder="Role name EN (e.g. Cook)"
                className="border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void addWorkawayRole()}
                className="glass-chip inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-foreground hover:text-accent"
              >
                <Plus size={14} /> Aggiungi al catalogo
              </button>
            </div>
          </div>
        </div>

    </>
  );
};

export default VoyageWorkawaySettingsPanel;
