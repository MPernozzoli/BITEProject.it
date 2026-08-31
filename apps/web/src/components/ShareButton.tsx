import { useCallback, useEffect, useState } from "react";
import { Image as ImageIcon, Link2 } from "lucide-react";
import { toast } from "sonner";
import AppleShareIcon from "@/components/AppleShareIcon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { getOrCreateVisitorKey } from "@/lib/visitor-key";
import { getAttribution } from "@/lib/attribution";
import {
  READER_SHARE_SOURCE,
  buildTrackedUrl,
  campaignFromUrl,
  normalizeTrackingToken,
  stripTrackingFromUrl,
} from "@/lib/utm";

interface ShareButtonProps {
  articleId?: string;
  instagramStoryImageUrl?: string | null;
  title?: string;
  url?: string;
  size?: number;
}

const filenameFromTitle = (title: string, mimeType: string, imageUrl: string) => {
  const safeBase = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "article";

  const pathname = (() => {
    try {
      return new URL(imageUrl).pathname;
    } catch {
      return imageUrl;
    }
  })();

  const matchedExt = pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  const ext = matchedExt || (mimeType === "image/png" ? "png" : "jpg");
  return `${safeBase}-instagram-story.${ext}`;
};

const createShareImageFile = async (imageUrl: string, title: string) => {
  try {
    const response = await fetch(imageUrl, { mode: "cors" });
    if (!response.ok) return null;
    const blob = await response.blob();
    const mimeType = blob.type || "image/jpeg";
    return new File([blob], filenameFromTitle(title, mimeType, imageUrl), { type: mimeType });
  } catch {
    return null;
  }
};

const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";

const triggerImageFallback = (imageUrl: string, filename: string) => {
  const anchor = document.createElement("a");
  anchor.href = imageUrl;
  anchor.download = filename;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.click();
};

const ShareButton = ({ articleId, instagramStoryImageUrl, title, url, size = 18 }: ShareButtonProps) => {
  const { lang } = useI18n();
  const isMobileViewport = useIsMobile();
  const [preparedInstagramFile, setPreparedInstagramFile] = useState<File | null>(null);
  const isIt = lang === "it";

  /**
   * Il link che esce da qui non è quello della barra degli indirizzi: porta i
   * tracker della condivisione, così il traffico che ne deriva si distingue da
   * quello dei canali che gestiamo noi. Prima si ripulisce l'URL corrente dai
   * tracker con cui *questo* lettore è arrivato: chi riceve il link non deve
   * ereditare la provenienza di chi glielo ha mandato.
   */
  const buildShareUrl = useCallback(
    (method: string) => {
      const base = stripTrackingFromUrl(url || window.location.href);
      return buildTrackedUrl(base, {
        source: READER_SHARE_SOURCE,
        medium: normalizeTrackingToken(method),
        campaign: campaignFromUrl(base),
      });
    },
    [url]
  );

  const trackShare = useCallback(
    async (method: string) => {
      if (!articleId) return;
      try {
        const visitorKey = getOrCreateVisitorKey();
        // Da dove veniva chi condivide: una condivisione partita da un lettore
        // arrivato via newsletter racconta che quel canale non porta solo letture.
        const attribution = getAttribution();
        await supabase.rpc("record_article_share", {
          _article_id: articleId,
          _visitor_key: visitorKey,
          _method: method,
          _source: attribution?.source ?? undefined,
          _medium: attribution?.medium ?? undefined,
          _campaign: attribution?.campaign ?? undefined,
        });
      } catch {
        // silent
      }
    },
    [articleId]
  );
  const isMobileDevice =
    isMobileViewport ||
    (typeof navigator !== "undefined" && /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent));

  useEffect(() => {
    let cancelled = false;
    setPreparedInstagramFile(null);

    if (!instagramStoryImageUrl) return () => { cancelled = true; };

    const shareTitle = title || document.title;
    void createShareImageFile(instagramStoryImageUrl, shareTitle).then((file) => {
      if (!cancelled) setPreparedInstagramFile(file);
    });

    return () => {
      cancelled = true;
    };
  }, [instagramStoryImageUrl, title]);

  const handleShareLink = async () => {
    const shareTitle = title || document.title;

    if (navigator.share) {
      const shareUrl = buildShareUrl("native");
      try {
        await navigator.share({ title: shareTitle, url: shareUrl });
        void trackShare("native");
        return;
      } catch (error) {
        if (isAbortError(error)) return;
      }
    }

    try {
      await navigator.clipboard.writeText(buildShareUrl("link"));
      void trackShare("link");
      toast.success(isIt ? "Link copiato." : "Link copied.");
    } catch {
      toast.error(isIt ? "Impossibile copiare il link." : "Could not copy the link.");
    }
  };

  const handleInstagramStoriesShare = async () => {
    const shareUrl = buildShareUrl("instagram_story");
    const shareTitle = title || document.title;

    if (!instagramStoryImageUrl) {
      toast.message(
        isIt
          ? "Per questa lingua non c'è un'immagine Instagram dedicata: condivido il link."
          : "No Instagram image is configured for this language, sharing the link instead."
      );
      await handleShareLink();
      return;
    }

    const imageFile = preparedInstagramFile || (await createShareImageFile(instagramStoryImageUrl, shareTitle));
    const shareData = imageFile
      ? { files: [imageFile], text: shareUrl, title: shareTitle, url: shareUrl }
      : null;

    if (shareData && navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
      try {
        await navigator.share(shareData);
        void trackShare("instagram_story");
        return;
      } catch (error) {
        if (isAbortError(error)) return;
      }
    }

    let linkCopied = false;
    try {
      await navigator.clipboard.writeText(shareUrl);
      linkCopied = true;
    } catch {
      linkCopied = false;
    }

    triggerImageFallback(
      instagramStoryImageUrl,
      imageFile?.name || filenameFromTitle(shareTitle, "image/jpeg", instagramStoryImageUrl)
    );

    void trackShare("instagram_story");

    toast.message(
      linkCopied
        ? isIt
          ? "Immagine aperta e link copiato. Da browser il passaggio diretto a Stories dipende dal supporto del dispositivo."
          : "Image opened and link copied. Direct Stories handoff from the browser depends on device support."
        : isIt
          ? "Immagine aperta. Su alcuni browser il link va aggiunto manualmente in Instagram."
          : "Image opened. On some browsers you may need to add the link manually in Instagram."
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="-mx-2 -my-2.5 inline-flex min-h-[44px] items-center gap-1.5 px-2 py-2.5 text-sm font-sans text-muted-foreground hover:text-foreground transition-colors"
          title={isIt ? "Condividi" : "Share"}
        >
          <AppleShareIcon size={size} />
          <span>{isIt ? "Condividi" : "Share"}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onClick={() => void handleShareLink()} className="flex items-center gap-2">
          <Link2 size={14} />
          <span>{isMobileDevice ? (isIt ? "Condividi link" : "Share link") : (isIt ? "Condividi" : "Share")}</span>
        </DropdownMenuItem>
        {isMobileDevice && (
          <DropdownMenuItem onClick={() => void handleInstagramStoriesShare()} className="flex items-center gap-2">
            <ImageIcon size={14} />
            <span>{isIt ? "Social" : "Social"}</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ShareButton;
