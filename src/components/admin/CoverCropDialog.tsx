import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { Loader2, RotateCcw, ZoomIn } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { clampCoverFocal, DEFAULT_COVER_FOCAL, type CoverFocal } from "@/lib/article-cover";

interface CoverCropDialogProps {
  open: boolean;
  imageUrl: string | null;
  value: CoverFocal;
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onConfirm: (value: CoverFocal) => Promise<void> | void;
}

const VIEWPORT_WIDTH = 420;
const VIEWPORT_ASPECT_RATIO = 16 / 10;
const VIEWPORT_HEIGHT = VIEWPORT_WIDTH / VIEWPORT_ASPECT_RATIO;
const MIN_ZOOM = 1;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.01;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const CoverCropDialog = ({
  open,
  imageUrl,
  value,
  loading = false,
  onOpenChange,
  onCancel,
  onConfirm,
}: CoverCropDialogProps) => {
  const [zoom, setZoom] = useState(DEFAULT_COVER_FOCAL.zoom);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const dragging = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });

  const isBusy = loading || isProcessing;

  const baseScale = useMemo(() => {
    if (!imageSize) return 1;
    return Math.max(VIEWPORT_WIDTH / imageSize.width, VIEWPORT_HEIGHT / imageSize.height);
  }, [imageSize]);

  const clampOffset = useCallback(
    (next: { x: number; y: number }, zoomValue: number) => {
      if (!imageSize) return { x: 0, y: 0 };

      const renderedWidth = imageSize.width * baseScale * zoomValue;
      const renderedHeight = imageSize.height * baseScale * zoomValue;
      const maxX = Math.max(0, (renderedWidth - VIEWPORT_WIDTH) / 2);
      const maxY = Math.max(0, (renderedHeight - VIEWPORT_HEIGHT) / 2);

      return {
        x: clamp(next.x, -maxX, maxX),
        y: clamp(next.y, -maxY, maxY),
      };
    },
    [baseScale, imageSize]
  );

  const focalToOffset = useCallback(
    (focal: CoverFocal, zoomValue: number) => {
      if (!imageSize) return { x: 0, y: 0 };

      const renderedWidth = imageSize.width * baseScale * zoomValue;
      const renderedHeight = imageSize.height * baseScale * zoomValue;

      return clampOffset(
        {
          x: ((50 - focal.focalX) / 100) * (renderedWidth - VIEWPORT_WIDTH),
          y: ((50 - focal.focalY) / 100) * (renderedHeight - VIEWPORT_HEIGHT),
        },
        zoomValue
      );
    },
    [baseScale, clampOffset, imageSize]
  );

  const offsetToFocal = useCallback(
    (nextOffset: { x: number; y: number }, zoomValue: number) => {
      if (!imageSize) {
        return { ...DEFAULT_COVER_FOCAL, zoom: zoomValue };
      }

      const renderedWidth = imageSize.width * baseScale * zoomValue;
      const renderedHeight = imageSize.height * baseScale * zoomValue;
      const horizontalRoom = Math.max(0, renderedWidth - VIEWPORT_WIDTH);
      const verticalRoom = Math.max(0, renderedHeight - VIEWPORT_HEIGHT);

      const focalX = horizontalRoom === 0 ? 50 : 50 - (nextOffset.x / horizontalRoom) * 100;
      const focalY = verticalRoom === 0 ? 50 : 50 - (nextOffset.y / verticalRoom) * 100;

      return clampCoverFocal(focalX, focalY, zoomValue);
    },
    [baseScale, imageSize]
  );

  useEffect(() => {
    if (!open || !imageUrl) {
      setImageSize(null);
      setZoom(DEFAULT_COVER_FOCAL.zoom);
      setOffset({ x: 0, y: 0 });
      return;
    }

    let cancelled = false;
    const img = new window.Image();
    img.onload = () => {
      if (cancelled) return;
      const nextZoom = clampCoverFocal(value.focalX, value.focalY, value.zoom).zoom;
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
      setZoom(nextZoom);
    };
    img.src = imageUrl;

    return () => {
      cancelled = true;
    };
  }, [imageUrl, open, value.focalX, value.focalY, value.zoom]);

  useEffect(() => {
    if (!imageSize || !open) return;
    setOffset(focalToOffset(value, clampCoverFocal(value.focalX, value.focalY, value.zoom).zoom));
  }, [focalToOffset, imageSize, open, value.focalX, value.focalY, value.zoom]);

  useEffect(() => {
    if (!imageSize) return;
    setOffset((current) => clampOffset(current, zoom));
  }, [clampOffset, imageSize, zoom]);

  const renderedSize = useMemo(() => {
    if (!imageSize) return null;
    return {
      width: imageSize.width * baseScale * zoom,
      height: imageSize.height * baseScale * zoom,
    };
  }, [baseScale, imageSize, zoom]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!imageSize || isBusy) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    lastPointer.current = { x: event.clientX, y: event.clientY };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !imageSize || isBusy) return;

    const dx = event.clientX - lastPointer.current.x;
    const dy = event.clientY - lastPointer.current.y;
    lastPointer.current = { x: event.clientX, y: event.clientY };

    setOffset((current) => clampOffset({ x: current.x + dx, y: current.y + dy }, zoom));
  };

  const stopDragging = (event?: ReactPointerEvent<HTMLDivElement>) => {
    if (event) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        /* noop */
      }
    }
    dragging.current = false;
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (isBusy) return;
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.08 : 0.08;
    setZoom((current) => clamp(current + delta, MIN_ZOOM, MAX_ZOOM));
  };

  const handleReset = () => {
    setZoom(DEFAULT_COVER_FOCAL.zoom);
    setOffset({ x: 0, y: 0 });
  };

  const handleConfirm = async () => {
    if (isBusy || !imageUrl) return;
    setIsProcessing(true);
    try {
      await onConfirm(offsetToFocal(offset, zoom));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (isBusy) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-w-3xl p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>Regola immagine copertina</DialogTitle>
          <DialogDescription>
            Posiziona l&apos;immagine dentro il riquadro. Puoi trascinare la foto e regolare lo zoom.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6 space-y-5">
          <div
            className="relative mx-auto w-full max-w-[640px] aspect-[16/10] overflow-hidden rounded-2xl border border-border bg-muted cursor-grab active:cursor-grabbing touch-none select-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={stopDragging}
            onPointerCancel={stopDragging}
            onWheel={handleWheel}
          >
            {imageUrl && renderedSize ? (
              <img
                src={imageUrl}
                alt=""
                draggable={false}
                className="absolute left-1/2 top-1/2 max-w-none pointer-events-none"
                style={{
                  width: `${renderedSize.width}px`,
                  height: `${renderedSize.height}px`,
                  transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                }}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="animate-spin" />
              </div>
            )}

            <div
              className="absolute inset-0 rounded-2xl border-2 border-white/90 pointer-events-none"
              style={{ boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.58)" }}
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="inline-flex items-center gap-2 text-xs font-sans tracking-wide text-muted-foreground uppercase">
                <ZoomIn size={14} /> Zoom
              </div>
              <button
                type="button"
                onClick={handleReset}
                disabled={isBusy}
                className="inline-flex items-center gap-1.5 text-xs font-sans text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                <RotateCcw size={13} /> Reimposta
              </button>
            </div>
            <Slider
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={ZOOM_STEP}
              value={[zoom]}
              disabled={isBusy || !imageSize}
              onValueChange={([next]) => setZoom(clamp(next ?? MIN_ZOOM, MIN_ZOOM, MAX_ZOOM))}
            />
          </div>

          <DialogFooter className="gap-2 sm:justify-between sm:space-x-0">
            <Button type="button" variant="outline" onClick={onCancel} disabled={isBusy}>
              Annulla
            </Button>
            <Button type="button" onClick={handleConfirm} disabled={isBusy || !imageSize}>
              {isBusy ? <Loader2 className="animate-spin" /> : null}
              Usa questo ritaglio
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CoverCropDialog;
