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

interface AvatarCropDialogProps {
  open: boolean;
  imageUrl: string | null;
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onConfirm: (blob: Blob) => Promise<void> | void;
}

const VIEWPORT_SIZE = 320;
const OUTPUT_SIZE = 1024;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.01;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const AvatarCropDialog = ({
  open,
  imageUrl,
  loading = false,
  onOpenChange,
  onCancel,
  onConfirm,
}: AvatarCropDialogProps) => {
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const dragging = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });

  const isBusy = loading || isProcessing;

  useEffect(() => {
    if (!open || !imageUrl) {
      setImageSize(null);
      setZoom(MIN_ZOOM);
      setOffset({ x: 0, y: 0 });
      return;
    }

    let cancelled = false;
    const img = new window.Image();
    img.onload = () => {
      if (cancelled) return;
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
      setZoom(MIN_ZOOM);
      setOffset({ x: 0, y: 0 });
    };
    img.src = imageUrl;

    return () => {
      cancelled = true;
    };
  }, [open, imageUrl]);

  const baseScale = useMemo(() => {
    if (!imageSize) return 1;
    return Math.max(VIEWPORT_SIZE / imageSize.width, VIEWPORT_SIZE / imageSize.height);
  }, [imageSize]);

  const clampOffset = useCallback(
    (next: { x: number; y: number }, zoomValue: number) => {
      if (!imageSize) return { x: 0, y: 0 };

      const renderedWidth = imageSize.width * baseScale * zoomValue;
      const renderedHeight = imageSize.height * baseScale * zoomValue;
      const maxX = Math.max(0, (renderedWidth - VIEWPORT_SIZE) / 2);
      const maxY = Math.max(0, (renderedHeight - VIEWPORT_SIZE) / 2);

      return {
        x: clamp(next.x, -maxX, maxX),
        y: clamp(next.y, -maxY, maxY),
      };
    },
    [baseScale, imageSize]
  );

  useEffect(() => {
    setOffset((current) => clampOffset(current, zoom));
  }, [clampOffset, zoom]);

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
    setZoom(MIN_ZOOM);
    setOffset({ x: 0, y: 0 });
  };

  const buildCroppedBlob = useCallback(async () => {
    if (!imageUrl || !imageSize) return null;

    const img = new window.Image();
    const imageLoaded = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Unable to load image for avatar crop"));
    });
    img.src = imageUrl;
    await imageLoaded;

    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas context unavailable");

    const ratio = OUTPUT_SIZE / VIEWPORT_SIZE;
    const drawWidth = imageSize.width * baseScale * zoom * ratio;
    const drawHeight = imageSize.height * baseScale * zoom * ratio;
    const drawX = OUTPUT_SIZE / 2 - drawWidth / 2 + offset.x * ratio;
    const drawY = OUTPUT_SIZE / 2 - drawHeight / 2 + offset.y * ratio;

    context.drawImage(img, drawX, drawY, drawWidth, drawHeight);

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/png");
    });
  }, [baseScale, imageSize, imageUrl, offset.x, offset.y, zoom]);

  const handleConfirm = async () => {
    if (isBusy || !imageUrl) return;
    setIsProcessing(true);
    try {
      const blob = await buildCroppedBlob();
      if (!blob) return;
      await onConfirm(blob);
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
      <DialogContent className="max-w-2xl p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>Ritaglia foto profilo</DialogTitle>
          <DialogDescription>
            Posiziona la foto dentro il cerchio. Puoi trascinare l&apos;immagine e regolare lo zoom.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6 space-y-5">
          <div
            className="relative mx-auto w-full max-w-[420px] aspect-square overflow-hidden rounded-2xl border border-border bg-muted cursor-grab active:cursor-grabbing touch-none select-none"
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
              className="absolute inset-0 rounded-full border-2 border-glass-edge/90 pointer-events-none"
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

export default AvatarCropDialog;
