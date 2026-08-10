import * as React from "react";
import { AtSign, BookOpen, ExternalLink, Map, Route, X } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { CommunityLinkedResource, CommunityReferenceKind, linkedResourcesFrom } from "@/lib/community";
import TiptapRenderer from "@/components/TiptapRenderer";

const crewSupabase = supabase as unknown as {
  from: (table: string) => any;
};

const kindLabels: Record<CommunityReferenceKind, string> = {
  article: "Articolo",
  story: "Storia",
  voyage: "Viaggio",
  leg: "Tratta",
};

const DEFAULT_REFERENCE_KINDS: CommunityReferenceKind[] = ["article", "story", "voyage", "leg"];

const iconFor = (kind: CommunityReferenceKind) => {
  if (kind === "article" || kind === "story") return BookOpen;
  if (kind === "leg") return Route;
  return Map;
};

const localizedTitle = (row: Record<string, unknown>, fallback = "Contenuto") =>
  String(row.title_it || row.title_en || row.name_it || row.name_en || row.name || fallback);

const voyagePath = (voyage: { id: string; slug?: string | null; slug_it?: string | null }) =>
  `/voyages/${voyage.slug_it || voyage.slug || voyage.id}`;

const escapeLike = (value: string) => value.replace(/[%_]/g, (match) => `\\${match}`);

export type CommunityMentionedProfile = {
  id: string;
  name: string;
  avatarUrl?: string | null;
};

type ComposerInputElement = HTMLTextAreaElement | HTMLInputElement;

const activeComposerToken = (input: ComposerInputElement | null, text: string) => {
  const caret = input?.selectionStart ?? text.length;
  const beforeCaret = text.slice(0, caret);
  const match = beforeCaret.match(/(^|\s)([#@])([^\s#@]*)$/);
  if (!match || match.index === undefined) return null;
  const prefix = match[1] ?? "";
  return {
    trigger: match[2] as "#" | "@",
    query: match[3] ?? "",
    start: match.index + prefix.length,
    end: caret,
  };
};

const replaceComposerToken = (
  input: ComposerInputElement | null,
  text: string,
  token: NonNullable<ReturnType<typeof activeComposerToken>>,
  replacement: string,
) => {
  const next = `${text.slice(0, token.start)}${replacement} ${text.slice(token.end)}`;
  window.requestAnimationFrame(() => {
    const caret = token.start + replacement.length + 1;
    input?.focus();
    input?.setSelectionRange(caret, caret);
  });
  return next;
};

export const CommunityReferenceCards = ({ resources }: { resources: unknown }) => {
  const items = linkedResourcesFrom(resources);
  const [articlePreview, setArticlePreview] = React.useState<CommunityLinkedResource | null>(null);
  if (!items.length) return null;

  return (
    <>
      <div className="mt-4 grid gap-2">
        {items.map((item) => {
          const Icon = iconFor(item.kind);
          return (
            <a
              key={`${item.kind}-${item.id}`}
              href={`https://biteproject.it${item.href}`}
              onClick={(event) => {
                if (item.kind !== "article") return;
                event.preventDefault();
                setArticlePreview(item);
              }}
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
      {articlePreview && <ArticleReferenceModal resource={articlePreview} onClose={() => setArticlePreview(null)} />}
    </>
  );
};

const ArticleReferenceModal = ({ resource, onClose }: { resource: CommunityLinkedResource; onClose: () => void }) => {
  const [article, setArticle] = React.useState<Record<string, unknown> | null>(null);
  const [authors, setAuthors] = React.useState<Array<{ id: string; name: string | null; avatar_url: string | null }>>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const { data } = await crewSupabase
        .from("logbook_articles")
        .select("id,title_it,title_en,excerpt_it,excerpt_en,content_it,content_en,cover_image,published_at,location_name")
        .eq("id", resource.id)
        .eq("status", "published")
        .maybeSingle();
      if (cancelled) return;
      setArticle(data ?? null);

      const { data: authorRows } = await crewSupabase
        .from("article_authors")
        .select("profile_id, profiles:public_profiles(id,name,avatar_url)")
        .eq("article_id", resource.id);
      if (!cancelled) {
        setAuthors((authorRows ?? []).map((row: any) => {
          const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
          return {
            id: row.profile_id,
            name: profile?.name ?? null,
            avatar_url: profile?.avatar_url ?? null,
          };
        }));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resource.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-[2rem] bg-[hsl(var(--background))] shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-[hsl(var(--background))]/95 px-5 py-4 backdrop-blur">
          <p className="truncate text-sm font-medium text-slate-950">{resource.label}</p>
          <div className="flex items-center gap-2">
            <a href={`https://biteproject.it${resource.href}`} className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-700" aria-label="Apri nel sito">
              <ExternalLink size={15} />
            </a>
            <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-950 text-white" aria-label="Chiudi">
              <X size={15} />
            </button>
          </div>
        </div>
        {loading ? (
          <p className="p-6 text-sm text-slate-500">Caricamento articolo...</p>
        ) : article ? (
          <article className="p-5 md:p-8">
            {typeof article.cover_image === "string" && article.cover_image && (
              <img src={article.cover_image} alt="" className="mb-6 max-h-[28rem] w-full rounded-[1.5rem] object-cover" />
            )}
            <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.16em] text-slate-500">
              {typeof article.location_name === "string" && article.location_name && <span>{article.location_name}</span>}
              {authors.length > 0 && <span>{authors.map((author) => author.name || "BITE").join(", ")}</span>}
            </div>
            <h2 className="mt-3 font-serif text-4xl leading-tight text-slate-950 md:text-6xl">
              {String(article.title_it || article.title_en || resource.label)}
            </h2>
            {(article.excerpt_it || article.excerpt_en) && (
              <p className="mt-4 text-lg leading-8 text-slate-600">{String(article.excerpt_it || article.excerpt_en)}</p>
            )}
            <div className="crew-panel mt-6 rounded-[1.5rem] p-5">
              <TiptapRenderer content={(article.content_it || article.content_en) as Record<string, unknown>} />
            </div>
          </article>
        ) : (
          <p className="p-6 text-sm text-slate-500">Articolo non disponibile.</p>
        )}
      </div>
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

  return <ReferencePickerInner value={value} onAdd={add} onRemove={remove} search={searchCommunityReferences} />;
};

export const searchCommunityReferences = async (kind: CommunityReferenceKind, query: string): Promise<CommunityLinkedResource[]> => {
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
      .select("id,name,name_it,name_en,slug,slug_it,start_date,end_date")
      .eq("is_published", true)
      .order("sort_order", { ascending: true })
      .limit(8);
    const { data } = clean ? await request.or(`name.ilike.${like},name_it.ilike.${like},name_en.ilike.${like}`) : await request;
    return (data ?? []).map((row: { id: string; name?: string | null; name_it?: string | null; name_en?: string | null; slug?: string | null; slug_it?: string | null; start_date?: string | null; end_date?: string | null }) => ({
      kind: "voyage" as const,
      id: row.id,
      label: row.name_it || row.name_en || row.name || "Viaggio",
      subtitle: [row.start_date, row.end_date].filter(Boolean).join(" - ") || null,
      href: voyagePath(row),
    }));
  }

  const { data } = await crewSupabase
    .from("voyage_bookable_legs")
    .select("id,sort_order,planned_nautical_miles,voyage_id,voyages(id,name,name_it,name_en,slug,slug_it),from:voyage_waypoints!voyage_bookable_legs_from_waypoint_id_fkey(name,name_it,name_en),to:voyage_waypoints!voyage_bookable_legs_to_waypoint_id_fkey(name,name_it,name_en)")
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
        href: `${voyagePath(voyage || { id: row.voyage_id })}?leg=${row.id}`,
        voyageId: String(row.voyage_id),
      };
    })
    .filter((item: CommunityLinkedResource) => !clean || `${item.label} ${item.subtitle || ""}`.toLowerCase().includes(clean.toLowerCase()))
    .slice(0, 8);
};

const searchMentionedProfiles = async (query: string): Promise<CommunityMentionedProfile[]> => {
  const clean = query.trim();
  const request = crewSupabase
    .from("public_profiles")
    .select("id,name,avatar_url")
    .not("id", "is", null)
    .order("name", { ascending: true })
    .limit(8);
  const { data } = clean ? await request.ilike("name", `%${escapeLike(clean)}%`) : await request;
  return (data ?? [])
    .filter((row: { id?: string | null; name?: string | null }) => row.id && row.name)
    .map((row: { id: string; name: string; avatar_url?: string | null }) => ({
      id: row.id,
      name: row.name,
      avatarUrl: row.avatar_url ?? null,
    }));
};

export const CommunityComposerTools = ({
  inputRef,
  text,
  onTextChange,
  resources,
  onResourcesChange,
  mentionedProfiles = [],
  onMentionedProfilesChange,
  referenceKinds = DEFAULT_REFERENCE_KINDS,
}: {
  inputRef: React.RefObject<ComposerInputElement>;
  text: string;
  onTextChange: (next: string) => void;
  resources: CommunityLinkedResource[];
  onResourcesChange: (next: CommunityLinkedResource[]) => void;
  mentionedProfiles?: CommunityMentionedProfile[];
  onMentionedProfilesChange?: (next: CommunityMentionedProfile[]) => void;
  referenceKinds?: CommunityReferenceKind[];
}) => {
  const token = activeComposerToken(inputRef.current, text);
  const [kind, setKind] = React.useState<CommunityReferenceKind>(referenceKinds[0] ?? "article");
  const [resourceResults, setResourceResults] = React.useState<CommunityLinkedResource[]>([]);
  const [profileResults, setProfileResults] = React.useState<CommunityMentionedProfile[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!referenceKinds.includes(kind)) setKind(referenceKinds[0] ?? "article");
  }, [kind, referenceKinds]);

  React.useEffect(() => {
    if (!token) {
      setResourceResults([]);
      setProfileResults([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      const request = token.trigger === "#"
        ? searchCommunityReferences(kind, token.query).then((items) => {
            if (!cancelled) setResourceResults(items);
          })
        : searchMentionedProfiles(token.query).then((items) => {
            if (!cancelled) setProfileResults(items);
          });
      void request.finally(() => {
        if (!cancelled) setLoading(false);
      });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [kind, text, token?.trigger, token?.query, token?.start, referenceKinds]);

  const addResource = (item: CommunityLinkedResource) => {
    if (!token) return;
    const exists = resources.some((existing) => existing.kind === item.kind && existing.id === item.id);
    if (!exists) onResourcesChange([...resources, item].slice(0, 8));
    onTextChange(replaceComposerToken(inputRef.current, text, token, `#${item.label.replace(/\s+/g, "_")}`));
  };

  const removeResource = (item: CommunityLinkedResource) => {
    onResourcesChange(resources.filter((existing) => !(existing.kind === item.kind && existing.id === item.id)));
  };

  const addProfile = (profile: CommunityMentionedProfile) => {
    if (!token) return;
    const exists = mentionedProfiles.some((existing) => existing.id === profile.id);
    if (!exists) onMentionedProfilesChange?.([...mentionedProfiles, profile].slice(0, 12));
    onTextChange(replaceComposerToken(inputRef.current, text, token, `@${profile.name.replace(/\s+/g, "_")}`));
  };

  const removeProfile = (profile: CommunityMentionedProfile) => {
    onMentionedProfilesChange?.(mentionedProfiles.filter((existing) => existing.id !== profile.id));
  };

  const showResourceMenu = token?.trigger === "#";
  const showProfileMenu = token?.trigger === "@";

  if (!showResourceMenu && !showProfileMenu && resources.length === 0 && mentionedProfiles.length === 0) return null;

  return (
    <div className="mt-2">
      {(resources.length > 0 || mentionedProfiles.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {resources.map((item) => (
            <button
              key={`${item.kind}-${item.id}`}
              type="button"
              onClick={() => removeResource(item)}
              className="inline-flex max-w-full items-center gap-2 rounded-full bg-slate-950 px-3 py-1.5 text-xs text-white"
            >
              <span className="truncate">#{item.label}</span>
              <X size={12} />
            </button>
          ))}
          {mentionedProfiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              onClick={() => removeProfile(profile)}
              className="inline-flex max-w-full items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-700"
            >
              <span className="truncate">@{profile.name}</span>
              <X size={12} />
            </button>
          ))}
        </div>
      )}

      {(showResourceMenu || showProfileMenu) && (
        <div className="mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.12)]">
          {showResourceMenu && (
            <div className="border-b border-slate-100 p-2">
              <div className="flex flex-wrap gap-1.5">
                {referenceKinds.map((item) => (
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
            </div>
          )}
          <div className="max-h-72 overflow-y-auto p-2">
            {loading ? (
              <p className="px-2 py-3 text-xs text-slate-500">Cerco...</p>
            ) : showResourceMenu && resourceResults.length ? (
              resourceResults.map((item) => (
                <button
                  key={`${item.kind}-${item.id}`}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => addResource(item)}
                  className="flex w-full items-center gap-3 rounded-xl p-2 text-left text-sm hover:bg-slate-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-950">{item.label}</span>
                    {item.subtitle && <span className="block truncate text-xs text-slate-500">{item.subtitle}</span>}
                  </span>
                  <span className="text-xs text-slate-400">{kindLabels[item.kind]}</span>
                </button>
              ))
            ) : showProfileMenu && profileResults.length ? (
              profileResults.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => addProfile(profile)}
                  className="flex w-full items-center gap-3 rounded-xl p-2 text-left text-sm hover:bg-slate-50"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-slate-500">
                    {profile.avatarUrl ? <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" /> : <AtSign size={15} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-950">{profile.name}</span>
                </button>
              ))
            ) : (
              <p className="px-2 py-3 text-xs text-slate-500">Nessun risultato.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
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
