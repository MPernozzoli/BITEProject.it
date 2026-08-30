import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

const MediaFigureNodeView = ({ node, updateAttributes, selected }: NodeViewProps) => {
  const attrs = (node.attrs ?? {}) as {
    kind?: "image" | "youtube";
    src?: string;
    caption?: string;
    aiGenerated?: boolean;
    title?: string;
    alt?: string;
  };
  const kind = attrs.kind === "youtube" ? "youtube" : "image";
  const caption = typeof attrs.caption === "string" ? attrs.caption : "";
  const title = typeof attrs.title === "string" ? attrs.title : "";
  const alt = typeof attrs.alt === "string" ? attrs.alt : "";
  const aiGenerated = Boolean(attrs.aiGenerated);
  const label = kind === "youtube" ? "Video" : "Immagine";

  return (
    <NodeViewWrapper
      as="figure"
      className={`article-editor-media my-6 overflow-hidden rounded-[28px] border bg-muted/20 p-3 ${
        selected ? "border-accent shadow-[0_0_0_2px_rgba(32,97,133,0.12)]" : "border-border"
      }`}
      data-media-kind={kind}
      data-ai-generated={aiGenerated ? "true" : "false"}
      contentEditable={false}
    >
      <div className="relative overflow-hidden rounded-[22px] border border-border bg-background">
        {kind === "youtube" ? (
          <div className="aspect-video bg-black">
            <iframe
              src={attrs.src}
              title={title || caption || "Embedded media"}
              className="h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
        ) : (
          <img
            src={attrs.src}
            alt={alt || caption || title || ""}
            title={title || caption || undefined}
            className="max-h-[32rem] w-full object-contain bg-background"
          />
        )}
        {aiGenerated && (
          <span className="pointer-events-none absolute bottom-3 right-3 inline-flex items-center justify-center rounded-full border border-glass-edge/30 bg-black/58 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white shadow-[0_10px_24px_rgba(0,0,0,0.26)] backdrop-blur-md">
            AI
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-col gap-3">
        <div className="text-[11px] font-sans uppercase tracking-[0.18em] text-muted-foreground">{label}</div>

        <label className="flex flex-col gap-2 text-xs font-sans text-muted-foreground">
          <span>Didascalia</span>
          <input
            type="text"
            value={caption}
            onChange={(event) => updateAttributes({ caption: event.target.value, alt: event.target.value || alt })}
            placeholder="Aggiungi una didascalia..."
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent"
          />
        </label>

        <label className="inline-flex items-center gap-2 text-sm font-sans text-foreground">
          <input
            type="checkbox"
            checked={aiGenerated}
            onChange={(event) => updateAttributes({ aiGenerated: event.target.checked })}
            className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
          />
          Contrassegna come media generato con IA
        </label>
      </div>
    </NodeViewWrapper>
  );
};

export default MediaFigureNodeView;
