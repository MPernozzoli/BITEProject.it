import { ExternalLink, Image, Link as LinkIcon, PlayCircle, Radio, Vote } from "lucide-react";
import { Link } from "react-router-dom";

import {
  CommunityLiveEvent,
  CommunityPoll,
  CommunityPollOption,
  CommunityPost,
  formatDateTime,
  liveStatusFor,
  liveStatusLabel,
} from "@/lib/community";

type CommunityPostSurfaceProps = {
  post: CommunityPost;
  poll?: CommunityPoll | null;
  pollOptions?: CommunityPollOption[];
  liveEvent?: CommunityLiveEvent | null;
  canVote?: boolean;
  busyPollId?: string | null;
  onVote?: (poll: CommunityPoll, option: CommunityPollOption) => void;
};

const mediaKindFor = (url: string) => {
  const clean = url.split("?")[0]?.toLowerCase() || "";
  if (/\.(mp4|webm|mov|m4v)$/.test(clean)) return "video";
  if (/\.(mp3|wav|m4a|aac|ogg)$/.test(clean)) return "audio";
  if (/\.(jpe?g|png|gif|webp|avif)$/.test(clean)) return "image";
  return "link";
};

const hostnameFor = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

const CommunityPostSurface = ({
  post,
  poll,
  pollOptions = [],
  liveEvent,
  canVote = false,
  busyPollId = null,
  onVote,
}: CommunityPostSurfaceProps) => {
  if (post.post_type === "link" && post.external_url) {
    return (
      <a
        href={post.external_url}
        target="_blank"
        rel="noreferrer"
        className="mt-4 flex items-center justify-between gap-4 rounded-3xl border border-slate-200 bg-white/78 p-4 text-sm text-slate-800 transition-colors hover:border-slate-950"
      >
        <span className="inline-flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-950 text-white">
            <LinkIcon size={16} />
          </span>
          <span className="min-w-0">
            <span className="block font-medium text-slate-950">Link condiviso</span>
            <span className="block truncate text-slate-500">{hostnameFor(post.external_url)}</span>
          </span>
        </span>
        <ExternalLink size={16} className="shrink-0 text-slate-400" />
      </a>
    );
  }

  if (post.post_type === "media" && Array.isArray(post.media_urls) && post.media_urls.length > 0) {
    const urls = post.media_urls.map(String).filter(Boolean);
    return (
      <div className="mt-4 grid gap-3">
        {urls.map((url) => {
          const kind = mediaKindFor(url);
          if (kind === "image") {
            return <img key={url} src={url} alt="" loading="lazy" className="max-h-[32rem] w-full rounded-3xl object-cover" />;
          }
          if (kind === "video") {
            return <video key={url} src={url} controls className="w-full rounded-3xl bg-slate-950" />;
          }
          if (kind === "audio") {
            return (
              <div key={url} className="rounded-3xl border border-slate-200 bg-white/78 p-4">
                <audio src={url} controls className="w-full" />
              </div>
            );
          }
          return (
            <a key={url} href={url} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-white/78 p-4 text-sm text-slate-700">
              <Image size={16} />
              <span className="truncate">{url}</span>
            </a>
          );
        })}
      </div>
    );
  }

  if (post.post_type === "poll" && poll) {
    const total = pollOptions.reduce((sum, option) => sum + (option.votes_count ?? 0), 0);
    const closed = Boolean(poll.closes_at && new Date(poll.closes_at).getTime() <= Date.now());
    return (
      <section className="mt-4 rounded-3xl border border-slate-200 bg-white/78 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-slate-500">
              <Vote size={13} />
              Poll
            </p>
            <h3 className="mt-2 font-serif text-2xl text-slate-950">{poll.question}</h3>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{total} voti</span>
        </div>
        <div className="mt-4 space-y-2">
          {pollOptions.map((option) => {
            const share = total ? Math.round(((option.votes_count ?? 0) / total) * 100) : 0;
            return (
              <button
                key={option.id}
                type="button"
                disabled={!canVote || closed || busyPollId === poll.id}
                onClick={() => onVote?.(poll, option)}
                className="w-full rounded-2xl border border-slate-200 bg-white p-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-70"
              >
                <span className="flex items-center justify-between gap-3 font-medium text-slate-950">
                  <span>{option.label}</span>
                  <span>{share}%</span>
                </span>
                <span className="mt-2 block h-2 overflow-hidden rounded-full bg-slate-100">
                  <span className="block h-full rounded-full bg-[hsl(var(--teal))]" style={{ width: `${share}%` }} />
                </span>
                {option.voted_by_me && <span className="mt-2 block text-xs text-slate-500">Voto registrato</span>}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-slate-500">{poll.allow_multiple ? "Scelta multipla" : "Scelta singola"}{closed ? " · chiuso" : ""}</p>
      </section>
    );
  }

  if (post.post_type === "live" && (liveEvent || post.live_starts_at)) {
    const startsAt = liveEvent?.starts_at ?? post.live_starts_at;
    const status = liveEvent ? liveStatusFor(liveEvent) : liveStatusFor({ starts_at: startsAt || new Date().toISOString(), ends_at: post.live_ends_at });
    const eventId = liveEvent?.id;
    return (
      <section className="mt-4 rounded-3xl border border-slate-200 bg-slate-950 p-4 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-white/65">
            <Radio size={13} />
            Live {liveEvent?.livekit_mode && liveEvent.livekit_mode !== "off" ? `· ${liveEvent.livekit_mode}` : ""}
          </span>
          <span className={`rounded-full px-3 py-1 text-xs ${status === "live" ? "bg-[hsl(var(--teal))] text-white" : "bg-white/10 text-white/75"}`}>
            {liveStatusLabel(status)}
          </span>
        </div>
        <p className="mt-3 font-serif text-2xl">{liveEvent?.title || post.title_it || post.title_en}</p>
        {startsAt && <p className="mt-1 text-sm text-white/65">{formatDateTime(startsAt)}</p>}
        {eventId && (
          <Link to={`/live?event=${eventId}`} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-medium text-slate-950">
            <PlayCircle size={15} />
            {status === "live" ? "Entra ora" : "Apri pagina live"}
          </Link>
        )}
      </section>
    );
  }

  return null;
};

export default CommunityPostSurface;
