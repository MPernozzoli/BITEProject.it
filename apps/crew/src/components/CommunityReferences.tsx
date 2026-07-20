import * as React from "react";
import { BookOpen, Map, Route, X } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { CommunityLinkedResource, CommunityReferenceKind, linkedResourcesFrom, slugify } from "@/lib/community";

const crewSupabase = supabase as unknown as {
  from: (table: string) => any;
};

const kindLabels: Record<CommunityReferenceKind, string> = {
  article: "Articolo",
  story: "Storia",
  voyage: "Viaggio",
  leg: "Tratta",
};

const iconFor = (kind: CommunityReferenceKind) => {
  if (kind === "article" || kind === "story") return BookOpen;
  if (kind === "leg") return Route;
  return Map;
};

const localizedTitle = (row: Record<string, unknown>, fallback = "Contenuto") =>
  String(row.title_it || row.title_en || row.name_it || row.name_en || row.name || fallback);

const voyagePath = (voyage: { id: string; name?: string | null; name_it?: string | null; name_en?: string | null }) =>
  `/voyages/${voyage.id}--${slugify(voyage.name_en || voyage.name_it || voyage.name || "voyage")}`;

const escapeLike = (value: string) => value.replace(/[%_]/g, (match) => `\\${match}`);

export const CommunityReferenceCards = ({ resources }: { resources: unknown }) => {
  const items = linkedResourcesFrom(resources);
  if (!items.length) return null;

  return (
    <div className="mt-4 grid gap-2">
      {items.map((item) => {
        const Icon = iconFor(item.kind);
        return (
          <a
            key={`${item.kind}-${item.id}`}
            href={`https://biteproject.it${item.href}`}
            className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-white/78 p-3 text-sm transition-colors hover:border-slate-950"
          >
            {item.coverImage ? (
              <img src={item.coverImage} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-2xl object-cover" />
            ) : (
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white">
                <Icon size={17} />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{kindLabels[item.kind]}</span>
              <span className="block truncate font-medium text-slate-950">{item.label}</span>
              {item.subtitle && <span className="block truncate text-xs text-slate-500">{item.subtitle}</span>}
            </span>
          </a>
        );
      })}
    </div>
  );
};

export const CommunityReferencePicker = ({
  value,
  onChange,
}: {
  value: CommunityLinkedResource[];
  onChange: (next: CommunityLinkedResource[]) => void;
}) => {
  const add = (item: CommunityLinkedResource) => {
    if (value.some((existing) => existing.kind === item.kind && existing.id === item.id)) return;
    onChange([...value, item].slice(0, 8));
  };

  const remove = (item: CommunityLinkedResource) => {
    onChange(value.filter((existing) => !(existing.kind === item.kind && existing.id === item.id)));
  };

  const search = async (kind: CommunityReferenceKind, query: string): Promise<CommunityLinkedResource[]> => {
    const clean = query.trim();
    const like = `%${escapeLike(clean)}%`;

    if (kind === "article") {
      const request = crewSupabase
        .from("logbook_articles")
        .select("id,title_it,title_en,slug,slug_it,cover_image,location_name,published_at")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(8);
      const { data } = clean ? await request.or(`title_it.ilike.${like},title_en.ilike.${like},slug.ilike.${like}`) : await request;
      return (data ?? []).map((row: Record<string, unknown>) => ({
        kind: "article" as const,
        id: String(row.id),
        label: localizedTitle(row, "Articolo"),
        subtitle: row.location_name ? String(row.location_name) : null,
        href: `/logbook/${String(row.slug_it || row.slug)}`,
        coverImage: row.cover_image ? String(row.cover_image) : null,
      }));
    }

    if (kind === "story") {
      const request = crewSupabase
        .from("stories")
        .select("id,title_it,title_en,slug,slug_it,cover_image")
        .order("created_at", { ascending: false })
        .limit(8);
      const { data } = clean ? await request.or(`title_it.ilike.${like},title_en.ilike.${like},slug.ilike.${like}`) : await request;
      return (data ?? []).map((row: Record<string, unknown>) => ({
        kind: "story" as const,
        id: String(row.id),
        label: localizedTitle(row, "Storia"),
        subtitle: "Arco narrativo",
        href: `/logbook/story/${String(row.slug_it || row.slug)}`,
        coverImage: row.cover_image ? String(row.cover_image) : null,
      }));
    }

    if (kind === "voyage") {
      const request = crewSupabase
        .from("voyages")
        .select("id,name,name_it,name_en,start_date,end_date")
        .eq("is_published", true)
        .order("sort_order", { ascending: true })
        .limit(8);
      const { data } = clean ? await request.or(`name.ilike.${like},name_it.ilike.${like},name_en.ilike.${like}`) : await request;
      return (data ?? []).map((row: { id: string; name?: string | null; name_it?: string | null; name_en?: string | null; start_date?: string | null; end_date?: string | null }) => ({
        kind: "voyage" as const,
        id: row.id,
        label: row.name_it || row.name_en || row.name || "Viaggio",
        subtitle: [row.start_date, row.end_date].filter(Boolean).join(" - ") || null,
        href: voyagePath(row),
      }));
    }

    const { data } = await crewSupabase
      .from("voyage_bookable_legs")
      .select("id,sort_order,planned_nautical_miles,voyage_id,voyages(id,name,name_it,name_en),from:voyage_waypoints!voyage_bookable_legs_from_waypoint_id_fkey(name,name_it,name_en),to:voyage_waypoints!voyage_bookable_legs_to_waypoint_id_fkey(name,name_it,name_en)")
      .order("sort_order", { ascending: true })
      .limit(12);

    return (data ?? [])
      .map((row: any) => {
        const voyage = Array.isArray(row.voyages) ? row.voyages[0] : row.voyages;
        const from = Array.isArray(row.from) ? row.from[0] : row.from;
        const to = Array.isArray(row.to) ? row.to[0] : row.to;
        const label = `${localizedTitle(from || {}, "Partenza")} → ${localizedTitle(to || {}, "Arrivo")}`;
        const voyageLabel = voyage?.name_it || voyage?.name_en || voyage?.name || "Viaggio";
        return {
          kind: "leg" as const,
          id: String(row.id),
          label,
          subtitle: `${voyageLabel} · ${Number(row.planned_nautical_miles || 0).toFixed(1)} NM`,
          href: `${voyagePath(voyage || { id: row.voyage_id, name: "voyage" })}?leg=${row.id}`,
          voyageId: String(row.voyage_id),
        };
      })
      .filter((item: CommunityLinkedResource) => !clean || `${item.label} ${item.subtitle || ""}`.toLowerCase().includes(clean.toLowerCase()))
      .slice(0, 8);
  };

  return <ReferencePickerInner value={value} onAdd={add} onRemove={remove} search={search} />;
};

const ReferencePickerInner = ({
  value,
  onAdd,
  onRemove,
  search,
}: {
  value: CommunityLinkedResource[];
  onAdd: (item: CommunityLinkedResource) => void;
  onRemove: (item: CommunityLinkedResource) => void;
  search: (kind: CommunityReferenceKind, query: string) => Promise<CommunityLinkedResource[]>;
}) => {
  const [kind, setKind] = React.useState<CommunityReferenceKind>("article");
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<CommunityLinkedResource[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void search(kind, query).then((items) => {
        if (!cancelled) setResults(items);
      }).finally(() => {
        if (!cancelled) setLoading(false);
      });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [kind, query, search]);

  return (
    <div className="mt-3 rounded-3xl border border-slate-200 bg-white/78 p-3">
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(kindLabels) as CommunityReferenceKind[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setKind(item)}
            className={`rounded-full px-3 py-1.5 text-xs ${kind === item ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700"}`}
          >
            {kindLabels[item]}
          </button>
        ))}
      </div>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Cerca contenuti da referenziare"
        className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
      />
      {value.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {value.map((item) => (
            <button
              key={`${item.kind}-${item.id}`}
              type="button"
              onClick={() => onRemove(item)}
              className="inline-flex max-w-full items-center gap-2 rounded-full bg-slate-950 px-3 py-1.5 text-xs text-white"
            >
              <span className="truncate">{item.label}</span>
              <X size={12} />
            </button>
          ))}
        </div>
      )}
      <div className="mt-3 grid gap-2">
        {loading ? (
          <p className="px-2 py-3 text-xs text-slate-500">Cerco...</p>
        ) : results.length ? (
          results.map((item) => (
            <button
              key={`${item.kind}-${item.id}`}
              type="button"
              onClick={() => onAdd(item)}
              className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left text-sm hover:border-slate-950"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-slate-950">{item.label}</span>
                {item.subtitle && <span className="block truncate text-xs text-slate-500">{item.subtitle}</span>}
              </span>
              <span className="text-xs text-slate-400">{kindLabels[item.kind]}</span>
            </button>
          ))
        ) : (
          <p className="px-2 py-3 text-xs text-slate-500">Nessun risultato.</p>
        )}
      </div>
    </div>
  );
};
