import DOMPurify from "dompurify";

type Node = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
  content?: Node[];
};

const textWithMarks = (node: Node) => {
  let content: React.ReactNode = node.text ?? "";
  for (const mark of node.marks ?? []) {
    if (mark.type === "bold") content = <strong>{content}</strong>;
    if (mark.type === "italic") content = <em>{content}</em>;
    if (mark.type === "underline") content = <u>{content}</u>;
    if (mark.type === "strike") content = <s>{content}</s>;
    if (mark.type === "code") content = <code>{content}</code>;
    if (mark.type === "link") {
      const href = typeof mark.attrs?.href === "string" ? mark.attrs.href : "#";
      content = <a href={href} target="_blank" rel="noopener noreferrer">{content}</a>;
    }
  }
  return content;
};

const children = (node: Node, keyPrefix: string) =>
  (node.content ?? []).map((child, index) => renderNode(child, `${keyPrefix}-${index}`));

const renderNode = (node: Node, key: string): React.ReactNode => {
  if (node.type === "text") return <span key={key}>{textWithMarks(node)}</span>;
  if (node.type === "paragraph") return <p key={key}>{children(node, key)}</p>;
  if (node.type === "heading") {
    const level = Number(node.attrs?.level ?? 2);
    if (level === 1) return <h2 key={key}>{children(node, key)}</h2>;
    if (level === 3) return <h3 key={key}>{children(node, key)}</h3>;
    return <h2 key={key}>{children(node, key)}</h2>;
  }
  if (node.type === "bulletList") return <ul key={key}>{children(node, key)}</ul>;
  if (node.type === "orderedList") return <ol key={key}>{children(node, key)}</ol>;
  if (node.type === "listItem") return <li key={key}>{children(node, key)}</li>;
  if (node.type === "blockquote") return <blockquote key={key}>{children(node, key)}</blockquote>;
  if (node.type === "horizontalRule") return <hr key={key} />;
  if (node.type === "hardBreak") return <br key={key} />;
  if (node.type === "codeBlock") return <pre key={key}><code>{(node.content ?? []).map((item) => item.text ?? "").join("")}</code></pre>;
  if (node.type === "image") {
    const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
    const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
    if (!src) return null;
    return <img key={key} src={src} alt={alt} loading="lazy" />;
  }
  if (node.type === "mediaFigure") {
    const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
    const kind = node.attrs?.kind === "youtube" ? "youtube" : "image";
    const caption = typeof node.attrs?.caption === "string" ? node.attrs.caption : "";
    const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : caption;
    if (!src) return null;
    return (
      <figure key={key}>
        {kind === "youtube" ? (
          <iframe
            src={src}
            title={caption || "Embedded media"}
            className="aspect-video w-full rounded-2xl"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        ) : (
          <img src={src} alt={alt} loading="lazy" className="rounded-2xl" />
        )}
        {caption && <figcaption>{DOMPurify.sanitize(caption)}</figcaption>}
      </figure>
    );
  }
  return <div key={key}>{children(node, key)}</div>;
};

const TiptapRenderer = ({ content }: { content: Record<string, unknown> | null | undefined }) => {
  const root = content as Node | null | undefined;
  if (!root || !Array.isArray(root.content)) return null;
  return <div className="crew-prose">{root.content.map((node, index) => renderNode(node, `node-${index}`))}</div>;
};

export default TiptapRenderer;

