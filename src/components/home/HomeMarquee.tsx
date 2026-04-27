type HomeMarqueeProps = {
  text: string;
};

export function HomeMarquee({ text }: HomeMarqueeProps) {
  const segment = `${text} \u00a0\u00a0\u00a0 `;
  return (
    <div
      className="home-marquee relative z-[5] overflow-hidden border-y border-white/[0.09] bg-[linear-gradient(90deg,rgba(6,14,26,0.94),rgba(14,32,48,0.82),rgba(6,14,26,0.94))] py-2.5 md:py-3"
      aria-hidden
    >
      <div className="home-marquee__mask w-full overflow-hidden">
        <div className="home-marquee__track flex w-max font-sans text-[10px] font-medium uppercase tracking-[0.42em] text-white/[0.42]">
          <span className="shrink-0 pr-20 md:pr-32">{segment}</span>
          <span className="shrink-0 pr-20 md:pr-32">{segment}</span>
        </div>
      </div>
    </div>
  );
}
