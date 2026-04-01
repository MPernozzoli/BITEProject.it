interface MapLoadingPlaceholderProps {
  label: string;
  className?: string;
}

const MapLoadingPlaceholder = ({ label, className = "" }: MapLoadingPlaceholderProps) => {
  return (
    <div
      className={`absolute inset-0 flex items-center justify-center bg-[linear-gradient(180deg,rgba(255,255,255,0.42),rgba(243,246,247,0.62))] ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="pointer-events-none w-[min(18rem,calc(100%-2rem))] rounded-[20px] border border-white/65 bg-white/80 px-4 py-4 shadow-[0_16px_40px_rgba(15,23,42,0.08)] backdrop-blur-sm">
        <div className="h-3 w-28 animate-pulse rounded-full bg-[rgba(159,207,214,0.45)]" />
        <div className="mt-3 space-y-2">
          <div className="h-2.5 w-full animate-pulse rounded-full bg-[rgba(15,23,42,0.08)]" />
          <div className="h-2.5 w-[82%] animate-pulse rounded-full bg-[rgba(15,23,42,0.08)]" />
          <div className="h-2.5 w-[64%] animate-pulse rounded-full bg-[rgba(15,23,42,0.08)]" />
        </div>
        <p className="mt-4 text-[11px] font-sans tracking-[0.18em] uppercase text-muted-foreground">
          {label}
        </p>
      </div>
    </div>
  );
};

export default MapLoadingPlaceholder;
