import createDOMPurify from "dompurify";

const YOUTUBE_EMBED_HOSTS = new Set([
  "www.youtube.com",
  "youtube.com",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
]);

const getPurifier = () => {
  if (typeof window === "undefined") return null;

  const purifier = createDOMPurify(window);

  purifier.addHook("afterSanitizeAttributes", (node) => {
    if (!(node instanceof Element)) return;

    for (const attributeName of node.getAttributeNames()) {
      if (attributeName.toLowerCase().startsWith("on")) {
        node.removeAttribute(attributeName);
      }
    }

    if (node instanceof HTMLAnchorElement) {
      const href = node.getAttribute("href");
      if (href && !isAllowedUrl(href, { allowRelative: true, allowContactProtocols: true })) {
        node.removeAttribute("href");
      }

      if (node.getAttribute("target") === "_blank") {
        node.setAttribute("rel", "noopener noreferrer");
      } else {
        node.removeAttribute("target");
        node.removeAttribute("rel");
      }
    }

    if (node instanceof HTMLImageElement) {
      const src = node.getAttribute("src");
      if (src && !isAllowedUrl(src, { allowRelative: true, allowContactProtocols: false })) {
        node.removeAttribute("src");
      }
    }

    if (node.tagName === "IFRAME") {
      const src = node.getAttribute("src");
      if (!src || !isAllowedYoutubeEmbed(src)) {
        node.remove();
        return;
      }

      node.setAttribute("loading", "lazy");
      node.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    }
  });

  return purifier;
};

let purifierInstance: ReturnType<typeof getPurifier> | null = null;

const isAllowedUrl = (
  value: string,
  options: {
    allowRelative: boolean;
    allowContactProtocols: boolean;
  }
) => {
  if (!value.trim()) return false;

  try {
    const parsed = new URL(value, window.location.origin);
    if (options.allowRelative && parsed.origin === window.location.origin) {
      return true;
    }
    return (
      parsed.protocol === "https:" ||
      parsed.protocol === "http:" ||
      (options.allowContactProtocols &&
        (parsed.protocol === "mailto:" || parsed.protocol === "tel:"))
    );
  } catch {
    return false;
  }
};

const isAllowedYoutubeEmbed = (value: string) => {
  try {
    const parsed = new URL(value, window.location.origin);
    return (
      ["https:", "http:"].includes(parsed.protocol) &&
      YOUTUBE_EMBED_HOSTS.has(parsed.hostname)
    );
  } catch {
    return false;
  }
};

export const sanitizeRichHtml = (html: string) => {
  if (!html.trim()) return "";

  purifierInstance ??= getPurifier();
  if (!purifierInstance) return html;

  return purifierInstance.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_TAGS: ["iframe"],
    ADD_ATTR: [
      "allow",
      "allowfullscreen",
      "class",
      "contenteditable",
      "data-ai-generated",
      "data-kind",
      "data-map-scene-anchor-id",
      "data-map-scene-anchor-scene-id",
      "data-map-scene-anchor-text",
      "data-media-figure",
      "loading",
      "referrerpolicy",
      "rel",
      "target",
      "title",
    ],
    FORBID_TAGS: ["base", "form", "input", "meta", "script", "style"],
  });
};
