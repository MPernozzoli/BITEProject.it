import { useRef } from "react";
import { RotateCcw } from "lucide-react";
import { clampCoverFocal, coverImageStyle, DEFAULT_COVER_FOCAL, type CoverFocal } from "@/lib/article-cover";

interface CoverFocalPickerProps {
  imageUrl: string;
  value: CoverFocal;
  onChange: (next: CoverFocal) => void;
}

/**
 * Pan (trascina) + rotella per zoom sulla copertina: definisce punto focale visibile nel reader.
 */
const CoverFocalPicker = ({ imageUrl, value, onChange }: CoverFocalPickerProps) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    last.current = { x: e.clientX, y: e.clientY };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current || !wrapRef.current) return;
    const dx = e.clientX - last.current.x;
    const dy = e.clientY - last.current.y;
    last.current = { x: e.clientX, y: e.clientY };
    const r = wrapRef.current.getBoundingClientRect();
    const dFx = (-dx / r.width) * 100;
    const dFy = (-dy / r.height) * 100;
    onChange(clampCoverFocal(value.focalX + dFx, value.focalY + dFy, value.zoom));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    dragging.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const fx = ((e.clientX - r.left) / r.width) * 100;
    const fy = ((e.clientY - r.top) / r.height) * 100;
    onChange(clampCoverFocal(fx, fy, value.zoom));
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.06 : 0.06;
    onChange(clampCoverFocal(value.focalX, value.focalY, value.zoom + delta));
  };

  const style = coverImageStyle(imageUrl, value);

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-sans text-muted-foreground leading-snug">
        Trascina per spostare il punto focale · rotellina per zoom · doppio click per centrare
      </p>
      <div
        ref={wrapRef}
        role="application"
        aria-label="Regola ritaglio copertina"
        className="relative aspect-[16/10] overflow-hidden border border-border bg-muted cursor-grab active:cursor-grabbing touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
      >
        {style && (
          <img src={imageUrl} alt="" className="pointer-events-none absolute inset-0 max-w-none" style={style} draggable={false} />
        )}
      </div>
      <button
        type="button"
        onClick={() => onChange({ ...DEFAULT_COVER_FOCAL })}
        className="inline-flex items-center gap-1.5 text-[10px] font-sans text-muted-foreground hover:text-foreground transition-colors"
      >
        <RotateCcw size={12} /> Ripristina ritaglio
      </button>
    </div>
  );
};

export default CoverFocalPicker;
