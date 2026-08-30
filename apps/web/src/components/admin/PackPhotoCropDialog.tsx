import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { Loader2, RotateCcw, RotateCw, ZoomIn } from "lucide-react";
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

interface PackPhotoCropDialogProps {
  open: boolean;
  imageUrl: string | null;
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onConfirm: (blob: Blob) => Promise<void> | void;
}

// The pack gallery renders every frame at aspect-[4/5]; the stored object matches so the
// gallery never has to letterbox or crop at display time.
const ASPECT_WIDTH = 4;
const ASPECT_HEIGHT = 5;
const OUTPUT_WIDTH = 1024;
const OUTPUT_HEIGHT = (OUTPUT_WIDTH * ASPECT_HEIGHT) / ASPECT_WIDTH; // 1280
const VIEWPORT_WIDTH = 360;
const VIEWPORT_HEIGHT = (VIEWPORT_WIDTH * ASPECT_HEIGHT) / ASPECT_WIDTH; // 450
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.01;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Bakes a 0/90/180/270° rotation into a fresh object URL. Doing it here keeps the crop
 * math below identical to the un-rotated case: the viewport always sees an upright image.
 */
const rotateToObjectUrl = (imageUrl: string, rotation: number): Promise<string> =>
  new Promise((resolve, reject) => {
    const normalized = ((rotation % 360) + 360) % 360;
    if (normalized === 0) {
      resolve(imageUrl);
      return;
    }

    const img = new window.Image();
    img.onload = () => {
      const swap = normalized === 90 || normalized === 270;
      const canvas = document.createElement("canvas");
      canvas.width = swap ? img.naturalHeight : img.naturalWidth;
      canvas.height = swap ? img.naturalWidth : img.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Canvas context unavailable"));
        return;
      }
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate((normalized * Math.PI) / 180);
      context.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Rotation produced no image"));
          return;
        }
        resolve(URL.createObjectURL(blob));
      }, "image/png");
    };
    img.onerror = () => reject(new Error("Unable to load image for rotation"));
    img.src = imageUrl;
  });

const PackPhotoCropDialog = ({
  open,
  imageUrl,
  loading = false,
  onOpenChange,
  onCancel,
  onConfirm,
}: PackPhotoCropDialogProps) => {
  const [rotation, setRotation] = useState(0);
  const [workingUrl, setWorkingUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const dragging = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });
  // Tracks the object URL we own, so rotating twice does not leak the first one.
  const ownedUrlRef = useRef<string | null>(null);

  const isBusy = loading || isProcessing;

  useEffect(() => {
    if (!open) {
      setRotation(0);
    }
  }, [open]);

  // Rebuilds the working image whenever the source or the rotation changes.
  useEffect(() => {
    if (!open || !imageUrl) {
      setWorkingUrl(null);
      setImageSize(null);
      return;
    }

    let cancelled = false;
    rotateToObjectUrl(imageUrl, rotation)
      .then((url) => {
        if (cancelled) {
          if (url !== imageUrl) URL.revokeObjectURL(url);
          return;
        }
        if (ownedUrlRef.current && ownedUrlRef.current !== imageUrl) {
          URL.revokeObjectURL(ownedUrlRef.current);
        }
        ownedUrlRef.current = url === imageUrl ? null : url;
        setWorkingUrl(url);
      })
      .catch(() => {
        if (!cancelled) setWorkingUrl(imageUrl);
      });

    return () => {
      cancelled = true;
    };
  }, [imageUrl, open, rotation]);

  // Frees the rotated URL when the dialog unmounts.
  useEffect(
    () => () => {
      if (ownedUrlRef.current) {
        URL.revokeObjectURL(ownedUrlRef.current);
        ownedUrlRef.current = null;
      }
    },
    []
  );

  useEffect(() => {
    if (!workingUrl) {
      setImageSize(null);
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
    img.src = workingUrl;

    return () => {
      cancelled = true;
    };
  }, [workingUrl]);

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

  const rotate = (direction: 1 | -1) => {
    if (isBusy) return;
    setRotation((current) => (current + direction * 90 + 360) % 360);
  };

  const buildCroppedBlob = useCallback(async () => {
    if (!workingUrl || !imageSize) return null;

    const img = new window.Image();
    const imageLoaded = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Unable to load image for gallery crop"));
    });
    img.src = workingUrl;
    await imageLoaded;

    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_WIDTH;
    canvas.height = OUTPUT_HEIGHT;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas context unavailable");

    const ratio = OUTPUT_WIDTH / VIEWPORT_WIDTH;
    const drawWidth = imageSize.width * baseScale * zoom * ratio;
    const drawHeight = imageSize.height * baseScale * zoom * ratio;
    const drawX = OUTPUT_WIDTH / 2 - drawWidth / 2 + offset.x * ratio;
    const drawY = OUTPUT_HEIGHT / 2 - drawHeight / 2 + offset.y * ratio;

    context.drawImage(img, drawX, drawY, drawWidth, drawHeight);

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/webp", 0.92);
    });
  }, [baseScale, imageSize, offset.x, offset.y, workingUrl, zoom]);

  const handleConfirm = async () => {
    if (isBusy || !workingUrl) return;
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
      <DialogContent className="max-w-lg p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>Ritaglia e ruota</DialogTitle>
          <DialogDescription>
            Trascina, regola lo zoom e ruota. La galleria mostra sempre questo formato 4:5.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6 space-y-5">
          <div
            className="relative mx-auto aspect-[4/5] w-full max-w-[360px] cursor-grab touch-none select-none overflow-hidden rounded-2xl border border-border bg-muted active:cursor-grabbing"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={stopDragging}
            onPointerCancel={stopDragging}
            onWheel={handleWheel}
          >
            {workingUrl && renderedSize ? (
              <img
                src={workingUrl}
                alt=""
                draggable={false}
                className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
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
              className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-glass-edge/90"
              style={{ boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.58)" }}
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="inline-flex items-center gap-2 text-xs font-sans uppercase tracking-wide text-muted-foreground">
                <ZoomIn size={14} /> Zoom
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => rotate(-1)}
                  disabled={isBusy || !imageSize}
                  className="inline-flex items-center gap-1.5 text-xs font-sans text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                >
                  <RotateCcw size={13} /> Ruota
                </button>
                <button
                  type="button"
                  onClick={() => rotate(1)}
                  disabled={isBusy || !imageSize}
                  className="inline-flex items-center gap-1.5 text-xs font-sans text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                >
                  <RotateCw size={13} /> Ruota
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={isBusy}
                  className="text-xs font-sans text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                >
                  Reimposta
                </button>
              </div>
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

export default PackPhotoCropDialog;
