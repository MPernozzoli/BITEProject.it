import { Node, mergeAttributes } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";

export type ArticleMapSceneAnchorAttrs = {
  anchorId: string;
  sceneId: string;
  sceneLabel: string;
  anchorText: string;
};

export const ArticleMapSceneAnchor = Node.create({
  name: "articleMapSceneAnchor",
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      anchorId: { default: "" },
      sceneId: { default: "" },
      sceneLabel: { default: "" },
      anchorText: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-map-scene-anchor-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    const sceneLabel = typeof HTMLAttributes.sceneLabel === "string" ? HTMLAttributes.sceneLabel : "";
    const anchorText = typeof HTMLAttributes.anchorText === "string" ? HTMLAttributes.anchorText : "";

    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-map-scene-anchor-id": HTMLAttributes.anchorId,
        "data-map-scene-anchor-scene-id": HTMLAttributes.sceneId,
        "data-map-scene-anchor-text": anchorText,
        class:
          "article-map-scene-anchor not-prose inline-flex items-center gap-1 rounded-full border border-[rgba(15,23,42,0.08)] bg-[rgba(255,255,255,0.86)] px-2 py-0.5 align-middle text-[11px] font-sans text-[hsl(201,58%,35%)] shadow-[0_6px_18px_rgba(15,23,42,0.08)]",
        contenteditable: "false",
      }),
      ["span", { class: "text-[12px]" }, "⌖"],
      ["span", {}, sceneLabel || "Map scene"],
    ];
  },
});

type AnchorSearchResult = {
  attrs: ArticleMapSceneAnchorAttrs;
  pos: number;
};

export const findSceneAnchorInContent = (
  content: JSONContent | Record<string, unknown> | null | undefined,
  sceneId: string
): AnchorSearchResult | null => {
  if (!content || typeof content !== "object") return null;

  let result: AnchorSearchResult | null = null;
  let position = 0;

  const visit = (node: JSONContent | Record<string, unknown>) => {
    if (result) return;

    const typedNode = node as JSONContent & { attrs?: Record<string, unknown>; content?: JSONContent[] };
    if (typedNode.type === "articleMapSceneAnchor" && typedNode.attrs?.sceneId === sceneId) {
      result = {
        attrs: {
          anchorId: String(typedNode.attrs.anchorId || ""),
          sceneId: String(typedNode.attrs.sceneId || ""),
          sceneLabel: String(typedNode.attrs.sceneLabel || ""),
          anchorText: String(typedNode.attrs.anchorText || ""),
        },
        pos: position,
      };
      return;
    }

    position += 1;
    if (Array.isArray(typedNode.content)) {
      typedNode.content.forEach((child) => visit(child));
    }
  };

  visit(content);
  return result;
};
