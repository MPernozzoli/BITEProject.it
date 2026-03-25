import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Edit, Trash2, X, ChevronUp, ChevronDown, Play, Check, MapPin } from "lucide-react";
import { toast } from "sonner";

interface RouteLeg {
  id: string;
  name: string;
  description: string;
  lat_start: number;
  lng_start: number;
  lat_end: number;
  lng_end: number;
  nautical_miles: number;
  status: "past" | "current" | "future";
  sort_order: number;
  started_at: string | null;
  completed_at: string | null;
}

const emptyForm: Omit<RouteLeg, 'id'> & { started_at: string; completed_at: string } = {
  name: "", description: "",
  lat_start: 0, lng_start: 0, lat_end: 0, lng_end: 0,
  nautical_miles: 0, status: "future", sort_order: 0,
  started_at: "", completed_at: "",
};

const AdminRouteManager = () => {
  const [legs, setLegs] = useState<RouteLeg[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<RouteLeg | null>(null);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => { fetchLegs(); }, []);

  const fetchLegs = async () => {
    const { data } = await supabase
      .from("route_legs" as any)
      .select("*")
      .order("sort_order", { ascending: true });
    setLegs((data || []) as any);
  };

  const openForm = (leg?: RouteLeg) => {
    if (leg) {
      setEditing(leg);
      setForm({
        name: leg.name,
        description: leg.description || "",
        lat_start: leg.lat_start,
        lng_start: leg.lng_start,
        lat_end: leg.lat_end,
        lng_end: leg.lng_end,
        nautical_miles: leg.nautical_miles,
        status: leg.status,
        sort_order: leg.sort_order,
        started_at: leg.started_at ? new Date(leg.started_at).toISOString().slice(0, 16) : "",
        completed_at: leg.completed_at ? new Date(leg.completed_at).toISOString().slice(0, 16) : "",
      });
    } else {
      setEditing(null);
      const maxOrder = legs.length ? Math.max(...legs.map((l) => l.sort_order)) + 1 : 0;
      setForm({ ...emptyForm, sort_order: maxOrder });
    }
    setShowForm(true);
  };

  const saveLeg = async () => {
    const data: any = {
      name: form.name,
      description: form.description,
      lat_start: form.lat_start,
      lng_start: form.lng_start,
      lat_end: form.lat_end,
      lng_end: form.lng_end,
      nautical_miles: form.nautical_miles,
      status: form.status,
      sort_order: form.sort_order,
      started_at: form.started_at ? new Date(form.started_at).toISOString() : null,
      completed_at: form.completed_at ? new Date(form.completed_at).toISOString() : null,
    };

    if (editing) {
      await supabase.from("route_legs" as any).update(data).eq("id", editing.id);
      toast.success("Leg updated");
    } else {
      await supabase.from("route_legs" as any).insert(data);
      toast.success("Leg created");
    }
    setShowForm(false);
    fetchLegs();
  };

  const deleteLeg = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    await supabase.from("route_legs" as any).delete().eq("id", id);
    toast.success("Leg deleted");
    fetchLegs();
  };

  const advanceToNext = async () => {
    const current = legs.find((l) => l.status === "current");
    const futureLegs = legs.filter((l) => l.status === "future").sort((a, b) => a.sort_order - b.sort_order);
    const next = futureLegs[0];

    if (current) {
      await supabase.from("route_legs" as any).update({
        status: "past",
        completed_at: new Date().toISOString(),
      }).eq("id", current.id);
    }

    if (next) {
      await supabase.from("route_legs" as any).update({
        status: "current",
        started_at: new Date().toISOString(),
      }).eq("id", next.id);
    }

    toast.success("Advanced to next leg");
    fetchLegs();
  };

  const moveLeg = async (leg: RouteLeg, direction: "up" | "down") => {
    const sorted = [...legs].sort((a, b) => a.sort_order - b.sort_order);
    const idx = sorted.findIndex((l) => l.id === leg.id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;

    const other = sorted[swapIdx];
    await Promise.all([
      supabase.from("route_legs" as any).update({ sort_order: other.sort_order }).eq("id", leg.id),
      supabase.from("route_legs" as any).update({ sort_order: leg.sort_order }).eq("id", other.id),
    ]);
    fetchLegs();
  };

  const statusColor = (s: string) => {
    if (s === "current") return "text-accent";
    if (s === "past") return "text-muted-foreground";
    return "text-foreground/70";
  };

  const statusBadge = (s: string) => {
    if (s === "current") return <span className="inline-flex items-center gap-1 text-[10px] font-sans tracking-wide uppercase bg-accent/10 text-accent px-2 py-0.5"><Play size={8} />Current</span>;
    if (s === "past") return <span className="inline-flex items-center gap-1 text-[10px] font-sans tracking-wide uppercase bg-muted text-muted-foreground px-2 py-0.5"><Check size={8} />Past</span>;
    return <span className="inline-flex items-center gap-1 text-[10px] font-sans tracking-wide uppercase bg-primary/5 text-foreground/60 px-2 py-0.5"><MapPin size={8} />Future</span>;
  };

  const pastLegs = legs.filter((l) => l.status === "past");
  const currentLeg = legs.find((l) => l.status === "current");
  const futureLegs = legs.filter((l) => l.status === "future");
  const totalMiles = pastLegs.reduce((sum, l) => sum + Number(l.nautical_miles), 0) + (currentLeg ? Number(currentLeg.nautical_miles) : 0);

  return (
    <div>
      {/* Stats bar */}
      <div className="flex items-center gap-6 mb-6 p-4 border border-border bg-muted/30">
        <div>
          <p className="text-[10px] font-sans tracking-[0.2em] uppercase text-muted-foreground">Total NM</p>
          <p className="editorial-heading text-xl">{totalMiles.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-[10px] font-sans tracking-[0.2em] uppercase text-muted-foreground">Legs</p>
          <p className="editorial-heading text-xl">{legs.length}</p>
        </div>
        {currentLeg && (
          <div className="flex-1 text-right">
            <p className="text-[10px] font-sans tracking-[0.2em] uppercase text-accent">Current</p>
            <p className="text-sm font-sans">{currentLeg.name}</p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => openForm()}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 text-sm font-sans font-medium hover:bg-navy-light transition-colors"
        >
          <Plus size={14} /> Add Leg
        </button>
        {futureLegs.length > 0 && (
          <button
            onClick={advanceToNext}
            className="inline-flex items-center gap-2 border border-accent text-accent px-4 py-2 text-sm font-sans hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <Play size={14} /> Advance to Next Leg
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div className="border border-border p-6 mb-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="editorial-heading text-lg">{editing ? "Edit Leg" : "New Leg"}</h3>
            <button onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Name</label>
              <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent" placeholder="e.g. Gdańsk → Bornholm" />
            </div>
            <div>
              <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Nautical Miles</label>
              <input type="number" value={form.nautical_miles} onChange={(e) => setForm((f) => ({ ...f, nautical_miles: Number(e.target.value) }))}
                className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent" />
            </div>
          </div>

          <div>
            <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Description</label>
            <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2}
              className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent resize-none" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Start Lat</label>
              <input type="number" step="0.0001" value={form.lat_start} onChange={(e) => setForm((f) => ({ ...f, lat_start: Number(e.target.value) }))}
                className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent" />
            </div>
            <div>
              <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Start Lng</label>
              <input type="number" step="0.0001" value={form.lng_start} onChange={(e) => setForm((f) => ({ ...f, lng_start: Number(e.target.value) }))}
                className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent" />
            </div>
            <div>
              <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">End Lat</label>
              <input type="number" step="0.0001" value={form.lat_end} onChange={(e) => setForm((f) => ({ ...f, lat_end: Number(e.target.value) }))}
                className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent" />
            </div>
            <div>
              <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">End Lng</label>
              <input type="number" step="0.0001" value={form.lng_end} onChange={(e) => setForm((f) => ({ ...f, lng_end: Number(e.target.value) }))}
                className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Status</label>
              <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as any }))}
                className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent">
                <option value="past">Past</option>
                <option value="current">Current</option>
                <option value="future">Future</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Started</label>
              <input type="datetime-local" value={form.started_at} onChange={(e) => setForm((f) => ({ ...f, started_at: e.target.value }))}
                className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent" />
            </div>
            <div>
              <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Completed</label>
              <input type="datetime-local" value={form.completed_at} onChange={(e) => setForm((f) => ({ ...f, completed_at: e.target.value }))}
                className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent" />
            </div>
          </div>

          <button onClick={saveLeg} className="bg-primary text-primary-foreground px-5 py-2 text-sm font-sans font-medium hover:bg-navy-light transition-colors">
            {editing ? "Update" : "Create"}
          </button>
        </div>
      )}

      {/* Legs list */}
      <div className="space-y-0">
        {legs.sort((a, b) => a.sort_order - b.sort_order).map((leg, i) => (
          <div key={leg.id} className={`flex items-center justify-between py-4 border-b border-border group ${leg.status === "current" ? "bg-accent/5 -mx-4 px-4" : ""}`}>
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <span className="text-xs font-sans text-muted-foreground/40 w-6 shrink-0">{String(i + 1).padStart(2, "0")}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  {statusBadge(leg.status)}
                  {leg.nautical_miles > 0 && (
                    <span className="text-[10px] font-sans text-muted-foreground">{Number(leg.nautical_miles)} NM</span>
                  )}
                </div>
                <h4 className={`text-sm font-sans font-medium truncate ${statusColor(leg.status)}`}>{leg.name}</h4>
                {leg.description && <p className="text-xs text-muted-foreground truncate">{leg.description}</p>}
              </div>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-4">
              <button onClick={() => moveLeg(leg, "up")} disabled={i === 0} className="p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-20"><ChevronUp size={14} /></button>
              <button onClick={() => moveLeg(leg, "down")} disabled={i === legs.length - 1} className="p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-20"><ChevronDown size={14} /></button>
              <button onClick={() => openForm(leg)} className="p-1.5 text-muted-foreground hover:text-foreground"><Edit size={14} /></button>
              <button onClick={() => deleteLeg(leg.id, leg.name)} className="p-1.5 text-muted-foreground hover:text-destructive"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>

      {legs.length === 0 && !showForm && (
        <div className="text-center py-16">
          <p className="text-muted-foreground mb-4">No route legs yet.</p>
          <button onClick={() => openForm()} className="inline-flex items-center gap-2 text-sm text-accent hover:text-foreground transition-colors">
            <Plus size={16} /> Add your first leg
          </button>
        </div>
      )}
    </div>
  );
};

export default AdminRouteManager;
