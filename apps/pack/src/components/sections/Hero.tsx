import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { duoPhotos } from "@/data/photos";
import { instagramProfile, metrics, uiCopy } from "@/data/site";
import { profiles } from "@/data/profiles";
import { cn } from "@/lib/utils";

type HeroChapter = {
  id: "intro" | "godot" | "freyja" | "kit";
  title: string;
  align: "center" | "left" | "right";
  layout?: "standard" | "kit";
  image: {
    x: number;
    y: number;
    scale: number;
  };
  kicker?: string;
  body?: string;
  stats?: { label: string; value: string }[];
};

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const lerp = (start: number, end: number, amount: number) => start + (end - start) * amount;
const smoothstep = (value: number) => value * value * (3 - 2 * value);

const godot = profiles.find((profile) => profile.id === "godot");
const freyja = profiles.find((profile) => profile.id === "freyja");

const heroChapters: HeroChapter[] = [
  {
    id: "intro",
    title: "Godot & Freyja",
    align: "center",
    image: { x: 0, y: -2, scale: 1.08 },
    body: uiCopy.hero.intro,
  },
  {
    id: "freyja",
    title: "Freyja",
    align: "left",
    image: { x: 18, y: -2, scale: 1.65 },
    kicker: freyja?.breed,
    body: freyja?.temperament,
    stats: [
      { label: uiCopy.hero.stats.weight, value: freyja?.weight ?? "30 kg" },
      { label: uiCopy.hero.stats.height, value: freyja?.height ?? "62 cm" },
      { label: uiCopy.hero.stats.coat, value: freyja?.coat ?? "Wolf-grey · white" },
      { label: uiCopy.hero.stats.set, value: uiCopy.hero.stats.freyjaSet },
    ],
  },
  {
    id: "godot",
    title: "Godot",
    align: "right",
    image: { x: -18, y: -2, scale: 1.65 },
    kicker: godot?.breed,
    body: godot?.temperament,
    stats: [
      { label: uiCopy.hero.stats.weight, value: godot?.weight ?? "48 kg" },
      { label: uiCopy.hero.stats.height, value: godot?.height ?? "68 cm" },
      { label: uiCopy.hero.stats.coat, value: uiCopy.hero.stats.godotCoat },
      { label: uiCopy.hero.stats.set, value: uiCopy.hero.stats.godotSet },
    ],
  },
  {
    id: "kit",
    title: uiCopy.hero.kitTitle,
    align: "center",
    layout: "kit",
    image: { x: 0, y: -2, scale: 1.08 },
    stats: [metrics[0], metrics[2], metrics[1], metrics[3]].map((metric) => ({
      label: metric.label,
      value: `${metric.value}${metric.suffix}`,
    })),
  },
];

const chapterProgress = heroChapters.map((_, index) => index / heroChapters.length);
const finalChapterProgress = chapterProgress[chapterProgress.length - 1];
const finalExitProgress = finalChapterProgress + (1 - finalChapterProgress) / 2;
const magneticSnapDelay = 140;
const magneticSnapMinDuration = 360;
const magneticSnapMaxDuration = 820;

const outerStatPositions = [
  "md:col-start-1 md:row-start-1",
  "md:col-start-5 md:row-start-1",
  "md:col-start-1 md:row-start-2",
  "md:col-start-5 md:row-start-2",
];

const ChapterStats = ({
  stats,
  variant = "standard",
}: {
  stats?: HeroChapter["stats"];
  variant?: "standard" | "outer";
}) => {
  if (!stats?.length) return null;

  return (
    <dl
      className={cn(
        "grid gap-3 sm:gap-4",
        variant === "outer"
          ? "mt-8 grid-cols-2 md:grid-cols-[minmax(220px,320px)_1fr_minmax(460px,1.4fr)_1fr_minmax(220px,320px)] md:gap-x-5"
          : "mt-8 grid-cols-2",
      )}
    >
      {stats.map((stat, index) => (
        <div
          key={`${stat.label}-${stat.value}`}
          className={cn(
            "rounded-[18px] border border-cream/12 bg-charcoal/42 p-4 backdrop-blur-md md:p-5",
            variant === "outer" && outerStatPositions[index],
          )}
        >
          <dt className="font-sans text-[10px] font-semibold uppercase tracking-[0.2em] text-bronze">
            {stat.label}
          </dt>
          <dd className="mt-2 font-serif text-[clamp(1.35rem,3vw,2.35rem)] leading-none text-cream">
            {stat.value}
          </dd>
        </div>
      ))}
    </dl>
  );
};

export const Hero = () => {
  const sectionRef = useRef<HTMLElement>(null);
  const snapTimerRef = useRef<number>();
  const snapFrameRef = useRef<number>();
  const snappingRef = useRef(false);
  const lastInputAtRef = useRef(0);
  const previousScrollBehaviorRef = useRef<string>();
  const [progress, setProgress] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReducedMotion(motionQuery.matches);
    updateMotion();
    motionQuery.addEventListener("change", updateMotion);
    return () => motionQuery.removeEventListener("change", updateMotion);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;

    let frame = 0;
    const update = () => {
      const section = sectionRef.current;
      if (!section) return;

      const rect = section.getBoundingClientRect();
      const scrollable = rect.height - window.innerHeight;
      setProgress(clamp(scrollable > 0 ? -rect.top / scrollable : 0));
    };

    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [reducedMotion]);

  useEffect(() => {
    if (reducedMotion) return;

    const clearSnap = () => {
      if (snapTimerRef.current) window.clearTimeout(snapTimerRef.current);
      if (snapFrameRef.current) window.cancelAnimationFrame(snapFrameRef.current);
      snapTimerRef.current = undefined;
      snapFrameRef.current = undefined;
      snappingRef.current = false;
      if (previousScrollBehaviorRef.current !== undefined) {
        document.documentElement.style.scrollBehavior = previousScrollBehaviorRef.current;
        previousScrollBehaviorRef.current = undefined;
      }
    };

    const cancelForUserInput = () => {
      lastInputAtRef.current = performance.now();
      if (snappingRef.current) clearSnap();
    };

    const getSnapTarget = () => {
      const section = sectionRef.current;
      if (!section) return null;

      const start = section.offsetTop;
      const scrollable = section.offsetHeight - window.innerHeight;
      const localScroll = window.scrollY - start;

      if (scrollable <= 0 || localScroll < 0 || localScroll > scrollable) return null;

      const currentProgress = clamp(localScroll / scrollable);
      if (currentProgress > finalExitProgress) return null;

      const nearestProgress = chapterProgress.reduce((closest, marker) => {
        return Math.abs(currentProgress - marker) < Math.abs(currentProgress - closest) ? marker : closest;
      }, chapterProgress[0]);
      const target = start + nearestProgress * scrollable;

      return Math.abs(target - window.scrollY) < 2 ? null : target;
    };

    const animateTo = (target: number) => {
      const startScroll = window.scrollY;
      const distance = target - startScroll;
      const duration = clamp(Math.abs(distance) * 0.45, magneticSnapMinDuration, magneticSnapMaxDuration);
      const startTime = performance.now();
      const root = document.documentElement;

      snappingRef.current = true;
      previousScrollBehaviorRef.current = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";

      const tick = (now: number) => {
        const elapsed = clamp((now - startTime) / duration);
        const eased = 1 - Math.pow(1 - elapsed, 3);

        window.scrollTo(0, startScroll + distance * eased);

        if (elapsed < 1) {
          snapFrameRef.current = window.requestAnimationFrame(tick);
          return;
        }

        snappingRef.current = false;
        snapFrameRef.current = undefined;
        if (previousScrollBehaviorRef.current !== undefined) {
          root.style.scrollBehavior = previousScrollBehaviorRef.current;
          previousScrollBehaviorRef.current = undefined;
        }
      };

      snapFrameRef.current = window.requestAnimationFrame(tick);
    };

    const scheduleSnap = () => {
      if (snappingRef.current) return;
      if (snapTimerRef.current) window.clearTimeout(snapTimerRef.current);

      snapTimerRef.current = window.setTimeout(() => {
        if (performance.now() - lastInputAtRef.current < magneticSnapDelay) {
          scheduleSnap();
          return;
        }

        const target = getSnapTarget();
        if (target !== null) animateTo(target);
      }, magneticSnapDelay);
    };

    const onScroll = () => {
      if (!snappingRef.current) scheduleSnap();
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", cancelForUserInput, { passive: true });
    window.addEventListener("touchstart", cancelForUserInput, { passive: true });
    window.addEventListener("touchmove", cancelForUserInput, { passive: true });
    window.addEventListener("keydown", cancelForUserInput);

    return () => {
      clearSnap();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", cancelForUserInput);
      window.removeEventListener("touchstart", cancelForUserInput);
      window.removeEventListener("touchmove", cancelForUserInput);
      window.removeEventListener("keydown", cancelForUserInput);
    };
  }, [reducedMotion]);

  const imageStyle = useMemo(() => {
    if (reducedMotion) {
      const { image } = heroChapters[0];
      return {
        transform: `translate3d(${image.x}%, ${image.y}%, 0) scale(${image.scale})`,
      };
    }

    const clampedProgress = Math.min(progress, finalChapterProgress);
    const nextIndex = chapterProgress.findIndex((marker) => marker >= clampedProgress);
    const endIndex = nextIndex === -1 ? heroChapters.length - 1 : nextIndex;
    const startIndex = Math.max(0, endIndex - 1);
    const startMarker = chapterProgress[startIndex];
    const endMarker = chapterProgress[endIndex];
    const localProgress =
      startIndex === endIndex ? 0 : smoothstep(clamp((clampedProgress - startMarker) / (endMarker - startMarker)));
    const start = heroChapters[startIndex].image;
    const end = heroChapters[endIndex].image;

    return {
      transform: `translate3d(${lerp(start.x, end.x, localProgress)}%, ${lerp(
        start.y,
        end.y,
        localProgress,
      )}%, 0) scale(${lerp(start.scale, end.scale, localProgress)})`,
    };
  }, [progress, reducedMotion]);

  return (
    <section
      ref={sectionRef}
      id="top"
      className="relative min-h-[420vh] bg-charcoal"
      aria-label={uiCopy.hero.aria}
    >
      <div className="sticky top-0 h-screen min-h-[720px] overflow-hidden">
        <img
          src={duoPhotos.studioExtended}
          alt={uiCopy.hero.alt}
          className="absolute inset-0 h-full w-full object-cover will-change-transform"
          style={{ ...imageStyle, objectPosition: "50% 58%" }}
          fetchPriority="high"
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(16,16,16,0.26),rgba(16,16,16,0.12)_34%,rgba(16,16,16,0.74))]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_52%,transparent_0%,transparent_31%,rgba(16,16,16,0.28)_62%,rgba(16,16,16,0.66)_100%)]" />
        <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-background to-transparent" />

        <div className="container-editorial relative z-10 flex h-full items-end pb-10 pt-28 md:items-center md:pb-0">
          {heroChapters.map((chapter, index) => {
            const distance = Math.abs(progress - chapterProgress[index]);
            const opacity = reducedMotion && index > 0 ? 0 : clamp(1 - distance * 3.5);
            const lift = (1 - opacity) * 18;
            const isKit = chapter.layout === "kit";

            return (
              <article
                key={chapter.id}
                aria-hidden={opacity < 0.05}
                className={cn(
                  "pointer-events-none absolute inset-x-4 bottom-10 will-change-[opacity,transform] md:inset-x-8 md:bottom-auto lg:inset-x-12",
                  isKit && "top-[3.75rem] mx-auto max-w-none text-center md:top-[4.5rem]",
                  !isKit && chapter.align === "center" && "mx-auto max-w-5xl text-center",
                  !isKit && chapter.align === "left" && "mr-auto max-w-[38rem] text-left",
                  !isKit && chapter.align === "right" && "ml-auto max-w-[38rem] text-right",
                )}
                style={{ opacity, transform: `translateY(${lift}px)` }}
              >
                {chapter.kicker && (
                  <p className="mb-4 font-sans text-[11px] font-semibold uppercase tracking-[0.28em] text-bronze">
                    {chapter.kicker}
                  </p>
                )}
                <h1
                  className={cn(
                    "font-serif leading-[0.88] tracking-tight text-cream drop-shadow-[0_18px_46px_rgba(0,0,0,0.5)]",
                    chapter.id === "intro" && "text-[clamp(3.7rem,10vw,8rem)]",
                    isKit && "text-[clamp(2.85rem,6vw,5.65rem)]",
                    chapter.id !== "intro" && !isKit && "text-[clamp(4rem,11vw,8.5rem)]",
                  )}
                >
                  {chapter.title}
                </h1>
                {chapter.body && (
                  <p
                    className={cn(
                      "mt-6 max-w-2xl font-sans text-base leading-relaxed text-cream/88 drop-shadow-[0_12px_32px_rgba(0,0,0,0.45)] md:text-xl",
                      chapter.align === "center" && "mx-auto",
                      isKit && "mt-4 max-w-[42rem] md:text-lg",
                    )}
                  >
                    {chapter.body}
                  </p>
                )}
                <ChapterStats stats={chapter.stats} variant={isKit ? "outer" : "standard"} />
                {chapter.id === "kit" && (
                  <a
                    href={instagramProfile.mediaKitUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pointer-events-auto mt-8 inline-flex h-12 items-center justify-center gap-3 rounded-full border border-cream/18 bg-cream/10 px-6 font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-cream backdrop-blur-md transition hover:bg-cream/16"
                  >
                    {uiCopy.actions.mediaKit}
                    <ArrowRight size={15} />
                  </a>
                )}
              </article>
            );
          })}
        </div>

        <div className="absolute bottom-6 left-1/2 z-20 hidden -translate-x-1/2 md:flex">
          <div className="hero-scroll-cue">
            <span className="hero-scroll-cue__label">{uiCopy.hero.scroll}</span>
            <span className="hero-scroll-cue__line" aria-hidden>
              <span className="hero-scroll-cue__dot" />
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};
