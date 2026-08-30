import type { Dispatch, SetStateAction } from "react";
import { Check, Loader2, Plus, Settings, Trash2 } from "lucide-react";
import type { BookingSettings, BookingTask } from "@/lib/booking-utils";

export interface BookingSettingsPanelProps {
  bookingSettings: BookingSettings;
  updateSettingsField: (
    field: keyof BookingSettings,
    value: string | number | boolean | string[],
  ) => void;
  isBookingSettingsDirty: boolean;
  saving: boolean;
  selectedVoyageId: string;
  saveBookingSettings: () => Promise<unknown>;
  bookingTasks: BookingTask[];
  setBookingTasks: Dispatch<SetStateAction<BookingTask[]>>;
  newTaskTitle: string;
  setNewTaskTitle: Dispatch<SetStateAction<string>>;
  addBookingTask: () => Promise<unknown>;
  updateBookingTask: (taskId: string, patch: Partial<BookingTask>) => Promise<unknown>;
  deleteBookingTask: (taskId: string) => Promise<unknown>;
}

const BookingSettingsPanel = ({
  bookingSettings,
  updateSettingsField,
  isBookingSettingsDirty,
  saving,
  selectedVoyageId,
  saveBookingSettings,
  bookingTasks,
  setBookingTasks,
  newTaskTitle,
  setNewTaskTitle,
  addBookingTask,
  updateBookingTask,
  deleteBookingTask,
}: BookingSettingsPanelProps) => {
  return (
    <section className="glass-panel rounded-[30px] p-5 md:p-6">
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <Settings size={17} className="text-accent" />
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Admin / bookings / settings</p>
            <h2 className="editorial-heading text-2xl">Prepartenza, briefing email e checklist</h2>
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
            Salva settings
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Deadline conferma ore</span>
          <input
            type="number"
            min="1"
            value={bookingSettings.confirmation_deadline_hours}
            onChange={(event) => updateSettingsField("confirmation_deadline_hours", Number(event.target.value))}
            className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
          />
        </label>
        <label className="block lg:col-span-3">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Info prepartenza IT</span>
          <textarea
            rows={4}
            value={bookingSettings.predeparture_info_it || ""}
            onChange={(event) => updateSettingsField("predeparture_info_it", event.target.value)}
            className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
          />
        </label>
        <label className="block lg:col-span-3">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Predeparture info EN</span>
          <textarea
            rows={4}
            value={bookingSettings.predeparture_info_en || ""}
            onChange={(event) => updateSettingsField("predeparture_info_en", event.target.value)}
            className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
          />
        </label>
        <fieldset className="lg:col-span-3 rounded-[22px] border border-border/70 bg-background/35 p-4">
          <legend className="px-2 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Mail briefing 1 · invio automatico alla conferma
          </legend>
          <p className="mb-4 text-sm text-muted-foreground">
            Riepilogo viaggio, spostamenti flessibili, bagaglio morbido, abbigliamento caldo/antivento, scarpe da barca e prodotti già disponibili a bordo.
          </p>
          <div className="grid gap-4">
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Briefing 1 IT</span>
              <textarea
                rows={9}
                value={bookingSettings.first_briefing_content_it || ""}
                onChange={(event) => updateSettingsField("first_briefing_content_it", event.target.value)}
                className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Briefing 1 EN</span>
              <textarea
                rows={9}
                value={bookingSettings.first_briefing_content_en || ""}
                onChange={(event) => updateSettingsField("first_briefing_content_en", event.target.value)}
                className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </label>
          </div>
        </fieldset>
        <fieldset className="lg:col-span-3 rounded-[22px] border border-border/70 bg-background/35 p-4">
          <legend className="px-2 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Mail briefing 2 · operativo a ridosso della partenza
          </legend>
          <p className="mb-4 text-sm text-muted-foreground">
            Vita a bordo, lavaggio a mano, Starlink, audio/proiettore, prese tipo L/F, USB-A/USB-C, frigo e suggerimenti per luoghi o esperienze.
          </p>
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[16px] border border-border/70 bg-glass/55 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Tipo L</p>
              <div className="mt-3 flex h-16 items-center justify-center gap-3 rounded-xl border border-border/60 bg-background/80">
                <span className="h-3 w-3 rounded-full border border-foreground/70" />
                <span className="h-3 w-3 rounded-full border border-foreground/70" />
                <span className="h-3 w-3 rounded-full border border-foreground/70" />
              </div>
            </div>
            <div className="rounded-[16px] border border-border/70 bg-glass/55 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Tipo F</p>
              <div className="mt-3 flex h-16 items-center justify-center rounded-xl border border-border/60 bg-background/80">
                <div className="flex h-12 w-12 items-center justify-center gap-4 rounded-full border-2 border-foreground/70">
                  <span className="h-3 w-3 rounded-full bg-foreground/70" />
                  <span className="h-3 w-3 rounded-full bg-foreground/70" />
                </div>
              </div>
            </div>
          </div>
          <div className="grid gap-4">
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Briefing 2 IT</span>
              <textarea
                rows={9}
                value={bookingSettings.second_briefing_content_it || ""}
                onChange={(event) => updateSettingsField("second_briefing_content_it", event.target.value)}
                className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Briefing 2 EN</span>
              <textarea
                rows={9}
                value={bookingSettings.second_briefing_content_en || ""}
                onChange={(event) => updateSettingsField("second_briefing_content_en", event.target.value)}
                className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </label>
          </div>
        </fieldset>
        <label className="block lg:col-span-3">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Termini / note operative IT</span>
          <textarea
            rows={3}
            value={bookingSettings.terms_content_it || ""}
            onChange={(event) => updateSettingsField("terms_content_it", event.target.value)}
            className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
          />
        </label>
        <label className="block lg:col-span-3">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Terms / operational notes EN</span>
          <textarea
            rows={3}
            value={bookingSettings.terms_content_en || ""}
            onChange={(event) => updateSettingsField("terms_content_en", event.target.value)}
            className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
          />
        </label>
      </div>

      <div className="mt-6 border-t border-border/70 pt-5">
        <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-end">
          <label className="block flex-1">
            <span className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Nuovo item checklist</span>
            <input
              value={newTaskTitle}
              onChange={(event) => setNewTaskTitle(event.target.value)}
              className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={() => void addBookingTask()}
            disabled={saving || !newTaskTitle.trim()}
            className="glass-chip inline-flex items-center justify-center gap-2 px-4 py-2 text-sm text-foreground hover:text-accent disabled:opacity-50"
          >
            <Plus size={15} /> Aggiungi
          </button>
        </div>
        <div className="space-y-2">
          {bookingTasks.map((task) => (
            <div key={task.id} className="grid gap-3 rounded-[18px] border border-border/70 p-3 md:grid-cols-[1fr_auto_auto] md:items-center">
              <input
                value={task.title_it}
                onChange={(event) => setBookingTasks((items) => items.map((item) => item.id === task.id ? { ...item, title_it: event.target.value } : item))}
                onBlur={(event) => void updateBookingTask(task.id, { title_it: event.target.value })}
                className="border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
              <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={task.required}
                  onChange={(event) => void updateBookingTask(task.id, { required: event.target.checked })}
                  className="h-4 w-4 accent-[hsl(var(--accent))]"
                />
                Required
              </label>
              <button
                type="button"
                onClick={() => void deleteBookingTask(task.id)}
                className="glass-chip inline-flex items-center justify-center gap-2 px-3 py-2 text-xs text-destructive"
              >
                <Trash2 size={13} /> Elimina
              </button>
            </div>
          ))}
          {bookingTasks.length === 0 && (
            <p className="text-sm text-muted-foreground">Nessuna checklist configurata per questo viaggio.</p>
          )}
        </div>
      </div>
    </section>
  );
};

export default BookingSettingsPanel;
