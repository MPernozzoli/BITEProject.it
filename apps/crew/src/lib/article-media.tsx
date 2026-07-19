import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import MediaFigureNodeView from "@/components/admin/MediaFigureNodeView";

export type MediaFigureKind = "image" | "youtube";

export type MediaFigureAttrs = {
  kind: MediaFigureKind;
  src: string;
  caption?: string;
  aiGenerated?: boolean;
  alt?: string;
  title?: string;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mediaFigure: {
      setMediaFigure: (attrs: MediaFigureAttrs) => ReturnType;
      updateMediaFigure: (attrs: Partial<MediaFigureAttrs>) => ReturnType;
    };
  }
}

const normalizeString = (value: unknown) => (typeof value === "string" ? value : "");

const createFigcaptionSpec = (caption: string) => {
  if (!caption) return null;
  return ["figcaption", { class: "article-media-meta" }, ["span", { class: "article-media-caption" }, caption]];
};

export const MediaFigure = Node.create({
  name: "mediaFigure",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      kind: {
        default: "image",
      },
      src: {
        default: "",
      },
      caption: {
        default: "",
      },
      aiGenerated: {
        default: false,
      },
      alt: {
        default: "",
      },
      title: {
        default: "",
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'figure[data-media-figure="true"]',
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const kind = element.dataset.kind === "youtube" ? "youtube" : "image";
          const mediaElement =
            kind === "youtube"
              ? element.querySelector("iframe")
              : element.querySelector("img");

          return {
            kind,
            src: mediaElement?.getAttribute("src") ?? "",
            caption: element.querySelector("figcaption")?.textContent ?? "",
            aiGenerated: element.dataset.aiGenerated === "true",
            alt: mediaElement?.getAttribute("alt") ?? "",
            title: mediaElement?.getAttribute("title") ?? "",
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const kind = HTMLAttributes.kind === "youtube" ? "youtube" : "image";
    const caption = normalizeString(HTMLAttributes.caption);
    const title = normalizeString(HTMLAttributes.title);
    const alt = normalizeString(HTMLAttributes.alt);
    const aiGenerated = Boolean(HTMLAttributes.aiGenerated);
    const figureAttrs = mergeAttributes(
      {
        "data-media-figure": "true",
        "data-kind": kind,
        "data-ai-generated": aiGenerated ? "true" : "false",
        class: "article-media-figure",
      },
    );
    const mediaSpec =
      kind === "youtube"
        ? ["iframe", {
            src: HTMLAttributes.src,
            title: title || caption || "Embedded media",
            allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
            allowfullscreen: "true",
            loading: "lazy",
          }]
        : ["img", {
            src: HTMLAttributes.src,
            alt: alt || caption || title || "",
            title: title || caption || undefined,
            loading: "lazy",
          }];
    const mediaFrameSpec = aiGenerated
      ? ["div", { class: "article-media-frame" }, mediaSpec, ["span", { class: "article-media-flag" }, "AI"]]
      : ["div", { class: "article-media-frame" }, mediaSpec];
    const figcaptionSpec = createFigcaptionSpec(caption);

    return figcaptionSpec
      ? ["figure", figureAttrs, mediaFrameSpec, figcaptionSpec]
      : ["figure", figureAttrs, mediaFrameSpec];
  },

  addCommands() {
    return {
      setMediaFigure:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs,
          }),
      updateMediaFigure:
        (attrs) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, attrs),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(MediaFigureNodeView);
  },
});
