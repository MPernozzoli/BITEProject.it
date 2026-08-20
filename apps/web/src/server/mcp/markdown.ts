/**
 * Markdown ⇄ TipTap JSON.
 *
 * Il corpo degli articoli è ProseMirror JSON (`logbook_articles.content_it/_en`)
 * con lo schema di `src/lib/article-content.ts`; un agente invece scrive e legge
 * Markdown. Questo modulo fa da ponte in entrambe le direzioni.
 *
 * Perché non `generateJSON` di TipTap: le estensioni del client tirano dentro
 * React (`MediaFigure` ha un node view) e un DOM, cose che in una function
 * serverless non vogliamo. Qui si costruisce l'albero ProseMirror direttamente
 * dai token di `marked`, che è deterministico, testabile e senza DOM.
 *
 * Regola di fedeltà: la conversione **non inventa nodi**. I nodi custom che
 * Markdown non sa rappresentare (mini-mappa, media figure con didascalia) sono
 * resi in sola lettura come testo riconoscibile e non vengono ricreati in
 * scrittura: chi vuole toccarli usa l'editor.
 */
import { marked, type Token, type Tokens } from "marked";

export interface JSONContent {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: JSONContent[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

// ============================================================================
// Markdown → TipTap
// ============================================================================

function inlineTokensToNodes(tokens: Token[] | undefined): JSONContent[] {
  if (!tokens || tokens.length === 0) return [];
  const out: JSONContent[] = [];

  const pushText = (text: string, marks: JSONContent["marks"]) => {
    if (!text) return;
    out.push(marks && marks.length > 0 ? { type: "text", text, marks } : { type: "text", text });
  };

  const walk = (list: Token[], marks: NonNullable<JSONContent["marks"]>) => {
    for (const token of list) {
      switch (token.type) {
        case "text": {
          const nested = (token as Tokens.Text).tokens;
          if (nested && nested.length > 0) walk(nested, marks);
          else pushText((token as Tokens.Text).text, marks);
          break;
        }
        case "escape":
          pushText((token as Tokens.Escape).text, marks);
          break;
        case "strong":
          walk((token as Tokens.Strong).tokens, [...marks, { type: "bold" }]);
          break;
        case "em":
          walk((token as Tokens.Em).tokens, [...marks, { type: "italic" }]);
          break;
        case "del":
          walk((token as Tokens.Del).tokens, [...marks, { type: "strike" }]);
          break;
        case "codespan":
          pushText((token as Tokens.Codespan).text, [...marks, { type: "code" }]);
          break;
        case "link": {
          const link = token as Tokens.Link;
          walk(link.tokens ?? [{ type: "text", raw: link.text, text: link.text } as Tokens.Text], [
            ...marks,
            { type: "link", attrs: { href: link.href, target: "_blank", rel: "noopener noreferrer nofollow" } },
          ]);
          break;
        }
        case "br":
          out.push({ type: "hardBreak" });
          break;
        case "image": {
          // Image non è un nodo inline nello schema dell'editor: l'immagine
          // trovata dentro un paragrafo viene estratta come blocco dal
          // chiamante, qui resta un segnaposto riconoscibile.
          const image = token as Tokens.Image;
          out.push({ type: "__image", attrs: { src: image.href, alt: image.text || null, title: image.title || null } });
          break;
        }
        case "html":
          pushText((token as Tokens.HTML).raw, marks);
          break;
        default: {
          const raw = (token as { raw?: string }).raw;
          if (raw) pushText(raw, marks);
        }
      }
    }
  };

  walk(tokens, []);
  return out;
}

/**
 * Separa i segnaposto immagine dagli inline veri: le immagini diventano blocchi
 * fratelli. `![alt](src "titolo")` — il "titolo" fra virgolette, sintassi
 * Markdown standard — diventa la didascalia di un `mediaFigure`, lo stesso
 * nodo con cui l'editor mostra foto con caption. Senza titolo resta
 * un'immagine semplice (`@tiptap/extension-image`), senza didascalia.
 */
function splitInline(nodes: JSONContent[]): { inline: JSONContent[]; images: JSONContent[] } {
  const inline: JSONContent[] = [];
  const images: JSONContent[] = [];
  for (const node of nodes) {
    if (node.type === "__image") {
      const attrs = node.attrs ?? {};
      if (attrs.title) {
        images.push({
          type: "mediaFigure",
          attrs: { kind: "image", src: attrs.src, alt: attrs.alt ?? "", caption: attrs.title },
        });
      } else {
        images.push({ type: "image", attrs: { src: attrs.src, alt: attrs.alt ?? null, title: null } });
      }
    } else {
      inline.push(node);
    }
  }
  return { inline, images };
}

function paragraphFrom(tokens: Token[] | undefined): JSONContent[] {
  const { inline, images } = splitInline(inlineTokensToNodes(tokens));
  const blocks: JSONContent[] = [];
  if (inline.length > 0) blocks.push({ type: "paragraph", content: inline });
  blocks.push(...images);
  if (blocks.length === 0) blocks.push({ type: "paragraph" });
  return blocks;
}

/** Una cella TipTap deve sempre contenere almeno un paragrafo, anche se vuota. */
function tableCellFrom(cell: Tokens.TableCell, type: "tableHeader" | "tableCell"): JSONContent {
  const { inline } = splitInline(inlineTokensToNodes(cell.tokens));
  return {
    type,
    content: [{ type: "paragraph", ...(inline.length > 0 ? { content: inline } : {}) }],
  };
}

function blockTokensToNodes(tokens: Token[]): JSONContent[] {
  const out: JSONContent[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case "space":
        break;
      case "heading": {
        const heading = token as Tokens.Heading;
        const { inline } = splitInline(inlineTokensToNodes(heading.tokens));
        out.push({
          type: "heading",
          // Lo schema dell'editor ammette solo h1-h3.
          attrs: { level: Math.min(Math.max(heading.depth, 1), 3) },
          content: inline,
        });
        break;
      }
      case "paragraph":
        out.push(...paragraphFrom((token as Tokens.Paragraph).tokens));
        break;
      case "text": {
        const text = token as Tokens.Text;
        out.push(...paragraphFrom(text.tokens ?? [{ type: "text", raw: text.raw, text: text.text } as Tokens.Text]));
        break;
      }
      case "blockquote":
        out.push({ type: "blockquote", content: blockTokensToNodes((token as Tokens.Blockquote).tokens) });
        break;
      case "code": {
        const code = token as Tokens.Code;
        out.push({
          type: "codeBlock",
          attrs: { language: code.lang || null },
          content: code.text ? [{ type: "text", text: code.text }] : [],
        });
        break;
      }
      case "hr":
        out.push({ type: "horizontalRule" });
        break;
      case "list": {
        const list = token as Tokens.List;
        const items = list.items.map((item) => ({
          type: "listItem",
          content: blockTokensToNodes(item.tokens as Token[]),
        }));
        out.push(
          list.ordered
            ? { type: "orderedList", attrs: { start: Number(list.start) || 1 }, content: items }
            : { type: "bulletList", content: items },
        );
        break;
      }
      case "table": {
        const table = token as Tokens.Table;
        const header = {
          type: "tableRow",
          content: table.header.map((cell) => tableCellFrom(cell, "tableHeader")),
        };
        const rows = table.rows.map((row) => ({
          type: "tableRow",
          content: row.map((cell) => tableCellFrom(cell, "tableCell")),
        }));
        out.push({ type: "table", content: [header, ...rows] });
        break;
      }
      case "html":
        // L'HTML grezzo non entra nello schema: diventa testo, così almeno non
        // sparisce senza che nessuno se ne accorga.
        out.push({ type: "paragraph", content: [{ type: "text", text: (token as Tokens.HTML).raw.trim() }] });
        break;
      default: {
        const raw = (token as { raw?: string }).raw?.trim();
        if (raw) out.push({ type: "paragraph", content: [{ type: "text", text: raw }] });
      }
    }
  }

  return out;
}

/** Converte Markdown nel documento ProseMirror atteso da `logbook_articles.content_*`. */
export function markdownToTiptap(markdown: string): JSONContent {
  const tokens = marked.lexer(markdown ?? "");
  const content = blockTokensToNodes(tokens);
  return { type: "doc", content: content.length > 0 ? content : [{ type: "paragraph" }] };
}

// ============================================================================
// TipTap → Markdown
// ============================================================================

const ESCAPABLE = /([\\`*_[\]])/g;

function escapeText(value: string): string {
  return value.replace(ESCAPABLE, "\\$1");
}

function applyMarks(text: string, marks: JSONContent["marks"]): string {
  if (!marks || marks.length === 0) return text;
  let out = text;
  for (const mark of marks) {
    switch (mark.type) {
      case "bold":
        out = `**${out}**`;
        break;
      case "italic":
        out = `*${out}*`;
        break;
      case "strike":
        out = `~~${out}~~`;
        break;
      case "code":
        out = `\`${out}\``;
        break;
      case "underline":
        // Markdown non ha il sottolineato: si conserva in HTML inline, che è
        // anche ciò che l'editor riparserebbe.
        out = `<u>${out}</u>`;
        break;
      case "link": {
        const href = typeof mark.attrs?.href === "string" ? mark.attrs.href : "";
        out = `[${out}](${href})`;
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function inlineToMarkdown(nodes: JSONContent[] | undefined): string {
  if (!nodes) return "";
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text": {
          const hasCode = node.marks?.some((mark) => mark.type === "code");
          return applyMarks(hasCode ? (node.text ?? "") : escapeText(node.text ?? ""), node.marks);
        }
        case "hardBreak":
          return "  \n";
        case "image":
          return `![${String(node.attrs?.alt ?? "")}](${String(node.attrs?.src ?? "")})`;
        case "articleMapSceneAnchor":
          return `⟨mappa: ${String(node.attrs?.sceneLabel ?? node.attrs?.anchorText ?? "scena")}⟩`;
        default:
          return inlineToMarkdown(node.content);
      }
    })
    .join("");
}

function tableCellToMarkdown(cell: JSONContent): string {
  // Markdown non gestisce blocchi dentro una cella: conserviamo i paragrafi
  // come line-break HTML, che Marked legge senza spezzare la tabella.
  return (cell.content ?? [])
    .map((child) => blockToMarkdown(child, 0))
    .filter(Boolean)
    .join("<br>")
    .replace(/\|/g, "\\|");
}

function tableToMarkdown(table: JSONContent): string {
  const rows = table.content ?? [];
  if (rows.length === 0) return "";

  const headerCells = rows[0].content ?? [];
  if (headerCells.length === 0) return "";
  const header = `| ${headerCells.map(tableCellToMarkdown).join(" | ")} |`;
  const divider = `| ${headerCells.map(() => "---").join(" | ")} |`;
  const body = rows.slice(1).map((row) => {
    const cells = row.content ?? [];
    // Il parser Markdown richiede lo stesso numero di colonne: le celle
    // mancanti diventano vuote, quelle extra restano rappresentate.
    const values = headerCells.map((_, index) => (cells[index] ? tableCellToMarkdown(cells[index]) : ""));
    return `| ${values.join(" | ")} |`;
  });
  return [header, divider, ...body].join("\n");
}

function blockToMarkdown(node: JSONContent, depth: number): string {
  switch (node.type) {
    case "paragraph":
      return inlineToMarkdown(node.content);
    case "heading": {
      const level = Number(node.attrs?.level ?? 1);
      return `${"#".repeat(Math.min(Math.max(level, 1), 6))} ${inlineToMarkdown(node.content)}`;
    }
    case "blockquote":
      return (node.content ?? [])
        .map((child) => blockToMarkdown(child, depth))
        .join("\n\n")
        .split("\n")
        .map((line) => `> ${line}`.trimEnd())
        .join("\n");
    case "codeBlock": {
      const language = typeof node.attrs?.language === "string" ? node.attrs.language : "";
      const text = (node.content ?? []).map((child) => child.text ?? "").join("");
      return `\`\`\`${language}\n${text}\n\`\`\``;
    }
    case "horizontalRule":
      return "---";
    case "table":
      return tableToMarkdown(node);
    case "bulletList":
    case "orderedList": {
      const ordered = node.type === "orderedList";
      const start = Number(node.attrs?.start ?? 1) || 1;
      return (node.content ?? [])
        .map((item, index) => {
          const marker = ordered ? `${start + index}. ` : "- ";
          const body = (item.content ?? [])
            .map((child) => blockToMarkdown(child, depth + 1))
            .join("\n\n")
            .split("\n")
            .map((line, lineIndex) => (lineIndex === 0 ? `${marker}${line}` : `${" ".repeat(marker.length)}${line}`))
            .join("\n");
          return body;
        })
        .join("\n");
    }
    case "image":
      return `![${String(node.attrs?.alt ?? "")}](${String(node.attrs?.src ?? "")})`;
    case "mediaFigure": {
      const caption = String(node.attrs?.caption ?? "");
      const alt = String(node.attrs?.alt ?? caption);
      const src = String(node.attrs?.src ?? "");
      const kind = String(node.attrs?.kind ?? "image");
      if (kind === "youtube") return `[video: ${caption || src}](${src})`;
      // Il "titolo" fra virgolette è sintassi Markdown standard: markdownToTiptap
      // lo rilegge come didascalia, così il round-trip non perde la caption.
      return caption ? `![${alt}](${src} "${caption}")` : `![${alt}](${src})`;
    }
    case "youtube":
      return `[video](${String(node.attrs?.src ?? "")})`;
    default:
      return inlineToMarkdown(node.content);
  }
}

/** Converte il documento ProseMirror in Markdown leggibile da un agente. */
export function tiptapToMarkdown(doc: unknown): string {
  const node = doc as JSONContent | null;
  if (!node || typeof node !== "object" || !Array.isArray(node.content)) return "";
  return node.content
    .map((child) => blockToMarkdown(child, 0))
    .filter((block) => block.trim().length > 0)
    .join("\n\n")
    .trim();
}

/** Conta le parole del corpo: serve per i riassunti dei tool di lettura. */
export function countWords(doc: unknown): number {
  const text = tiptapToMarkdown(doc).replace(/[#*_`>[\]()!-]/g, " ");
  return text.split(/\s+/).filter(Boolean).length;
}
