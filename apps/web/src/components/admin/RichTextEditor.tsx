import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Youtube from "@tiptap/extension-youtube";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { MediaFigure, type MediaFigureAttrs } from "@/lib/article-media";
import { ArticleMapSceneAnchor } from "@/lib/article-map-anchor";
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Quote, Minus, Undo, Redo,
  Image as ImageIcon, Link as LinkIcon, Youtube as YoutubeIcon,
  Type, Heading1, Heading2, Heading3, Palette, Code, MapPinned, Table, Rows3, Columns3, Trash2,
} from "lucide-react";

interface RichTextEditorProps {
  content: unknown;
  onChange: (content: object) => void;
  onHtmlChange?: (html: string) => void;
  placeholder?: string;
  mapScenes?: Array<{ id: string; label: string }>;
  onMapSceneLink?: (sceneId: string, payload: { anchorId: string; anchorPreview: string }) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeEditorContent = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value === "string") {
    try {
      return normalizeEditorContent(JSON.parse(value));
    } catch {
      return undefined;
    }
  }

  if (!isRecord(value) || Object.keys(value).length === 0) {
    return undefined;
  }

  return value;
};

const MenuButton = ({
  onClick,
  active,
  disabled,
  children,
  title,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  title?: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`p-1.5 rounded-sm transition-colors ${
      active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
    } ${disabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer"}`}
  >
    {children}
  </button>
);

const RichTextEditor = ({
  content,
  onChange,
  onHtmlChange,
  placeholder = "Start writing...",
  mapScenes = [],
  onMapSceneLink,
}: RichTextEditorProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingInsertPositionRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const normalizedContent = useMemo(() => normalizeEditorContent(content), [content]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; from: number; to: number } | null>(null);

  const generateAnchorId = () =>
    globalThis.crypto?.randomUUID?.() ?? `scene-anchor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      MediaFigure,
      ArticleMapSceneAnchor,
      Image.configure({ inline: false, allowBase64: true }),
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "text-accent underline" } }),
      Youtube.configure({ width: 640, height: 360, nocookie: true }),
      TextStyle,
      Color,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Underline,
      TableKit.configure({ table: { resizable: true } }),
      Placeholder.configure({ placeholder }),
    ],
    content: normalizedContent,
    onUpdate: ({ editor }) => {
      onChange(editor.getJSON());
      onHtmlChange?.(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class:
          "article-rich-body prose prose-lg dark:prose-invert max-w-none focus:outline-none min-h-[300px] p-4 font-sans [&_p]:min-h-[1em]",
      },
      handleDrop: (_view, event) => {
        const droppedFiles = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
          file.type.startsWith("image/")
        );

        if (!droppedFiles.length || !editor) return false;

        event.preventDefault();
        const coordinates = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
        const insertPos = coordinates?.pos ?? editor.state.selection.from;
        void handleMediaFiles(droppedFiles, insertPos);
        return true;
      },
      handlePaste: (_view, event) => {
        const pastedFiles = Array.from(event.clipboardData?.files ?? []).filter((file) =>
          file.type.startsWith("image/")
        );

        if (!pastedFiles.length || !editor) return false;

        event.preventDefault();
        void handleMediaFiles(pastedFiles, editor.state.selection.from);
        return true;
      },
    },
  });

  useEffect(() => {
    if (!editor) return;

    const nextContentKey = normalizedContent ? JSON.stringify(normalizedContent) : null;
    const currentContentKey = JSON.stringify(editor.getJSON());

    if (nextContentKey === currentContentKey) {
      return;
    }

    if (!normalizedContent) {
      editor.commands.clearContent(false);
      return;
    }

    editor.commands.setContent(normalizedContent, { emitUpdate: false });
  }, [editor, normalizedContent]);

  useEffect(() => {
    if (!contextMenu) return;

    const handleMouseDown = (event: MouseEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return;
      setContextMenu(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!editor || !mapScenes.length) return;

    const transaction = editor.state.tr;
    let hasChanges = false;

    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== "articleMapSceneAnchor") return true;

      const sceneId = String(node.attrs.sceneId || "");
      const nextLabel = mapScenes.find((scene) => scene.id === sceneId)?.label;
      if (!nextLabel || nextLabel === node.attrs.sceneLabel) return true;

      transaction.setNodeMarkup(pos, undefined, { ...node.attrs, sceneLabel: nextLabel });
      hasChanges = true;
      return true;
    });

    if (hasChanges) {
      editor.view.dispatch(transaction);
    }
  }, [editor, mapScenes]);

  const uploadMediaFile = useCallback(async (file: File) => {
    const ext = file.name.split(".").pop();
    const path = `articles/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("logbook-media").upload(path, file);
    if (error) {
      console.error("Upload error:", error);
      return null;
    }
    const { data: urlData } = supabase.storage.from("logbook-media").getPublicUrl(path);
    return urlData.publicUrl;
  }, []);

  const insertMediaFigure = useCallback((attrs: MediaFigureAttrs, position?: number | null) => {
    if (!editor) return;

    if (typeof position === "number") {
      editor.chain().focus().insertContentAt(position, { type: "mediaFigure", attrs }).run();
      return;
    }

    editor.chain().focus().insertContent({ type: "mediaFigure", attrs }).run();
  }, [editor]);

  const handleMediaFiles = useCallback(async (files: File[], startPosition?: number | null) => {
    if (!editor) return;

    let nextPosition = typeof startPosition === "number" ? startPosition : editor.state.selection.from;

    for (const file of files) {
      const publicUrl = await uploadMediaFile(file);
      if (!publicUrl) continue;

      insertMediaFigure(
        {
          kind: "image",
          src: publicUrl,
          caption: "",
          aiGenerated: false,
          alt: "",
          title: file.name,
        },
        nextPosition
      );

      nextPosition += 2;
    }
  }, [editor, insertMediaFigure, uploadMediaFile]);

  const addImage = useCallback(() => {
    if (editor) {
      pendingInsertPositionRef.current = editor.state.selection.from;
    }
    fileInputRef.current?.click();
  }, [editor]);

  const addImageFromUrl = useCallback(() => {
    const url = window.prompt("Image URL:");
    if (url && editor) {
      insertMediaFigure({
        kind: "image",
        src: url,
        caption: "",
        aiGenerated: false,
        alt: "",
        title: "",
      }, pendingInsertPositionRef.current ?? editor.state.selection.from);
      pendingInsertPositionRef.current = null;
    }
  }, [editor, insertMediaFigure]);

  const addLink = useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes("link").href;
    const url = window.prompt("URL:", previousUrl);
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor]);

  const addYoutube = useCallback(() => {
    const url = window.prompt("YouTube URL:");
    if (url && editor) {
      insertMediaFigure({
        kind: "youtube",
        src: url,
        caption: "",
        aiGenerated: false,
        alt: "",
        title: "",
      }, pendingInsertPositionRef.current ?? editor.state.selection.from);
      pendingInsertPositionRef.current = null;
    }
  }, [editor, insertMediaFigure]);

  const setColor = useCallback(() => {
    const color = window.prompt("Color (hex, e.g. #ff0000):");
    if (color && editor) {
      editor.chain().focus().setColor(color).run();
    }
  }, [editor]);

  const removeExistingSceneAnchors = useCallback((sceneId: string) => {
    if (!editor) return;

    const positions: Array<{ from: number; to: number }> = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "articleMapSceneAnchor" && node.attrs.sceneId === sceneId) {
        positions.push({ from: pos, to: pos + node.nodeSize });
      }
      return true;
    });

    if (!positions.length) return;

    const transaction = editor.state.tr;
    [...positions].reverse().forEach((range) => transaction.delete(range.from, range.to));
    editor.view.dispatch(transaction);
  }, [editor]);

  const linkSceneToSelection = useCallback((sceneId: string) => {
    if (!editor || !contextMenu) return;

    const scene = mapScenes.find((item) => item.id === sceneId);
    if (!scene) return;

    const selectedText = editor.state.doc.textBetween(contextMenu.from, contextMenu.to, " ").trim();
    const anchorPreview = selectedText.length > 72 ? `${selectedText.slice(0, 71)}…` : selectedText;
    const anchorId = generateAnchorId();

    removeExistingSceneAnchors(sceneId);

    const nextSelectionTo = Math.min(contextMenu.to, editor.state.doc.content.size);
    editor
      .chain()
      .focus()
      .insertContentAt(nextSelectionTo, {
        type: "articleMapSceneAnchor",
        attrs: {
          anchorId,
          sceneId,
          sceneLabel: scene.label,
          anchorText: anchorPreview,
        },
      })
      .run();

    onMapSceneLink?.(sceneId, { anchorId, anchorPreview });
    setContextMenu(null);
  }, [contextMenu, editor, mapScenes, onMapSceneLink, removeExistingSceneAnchors]);

  if (!editor) return null;

  return (
    <div
      ref={containerRef}
      className="relative border border-border rounded-sm bg-background"
      onContextMenu={(event) => {
        if (!editor) return;
        const { from, to, empty } = editor.state.selection;
        if (empty || to <= from || mapScenes.length === 0) return;
        event.preventDefault();
        setContextMenu({ x: event.clientX, y: event.clientY, from, to });
      }}
    >
      {/* Toolbar */}
      <div className="sticky top-24 z-40 border-b border-border bg-background/95 p-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex flex-wrap gap-0.5 overflow-x-auto">
          {/* Text formatting */}
          <MenuButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} title="Bold">
            <Bold size={16} />
          </MenuButton>
          <MenuButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} title="Italic">
            <Italic size={16} />
          </MenuButton>
          <MenuButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive("underline")} title="Underline">
            <UnderlineIcon size={16} />
          </MenuButton>
          <MenuButton onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")} title="Strikethrough">
            <Strikethrough size={16} />
          </MenuButton>
          <MenuButton onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive("code")} title="Code">
            <Code size={16} />
          </MenuButton>

          <div className="mx-1 w-px bg-border" />

          {/* Headings */}
          <MenuButton onClick={() => editor.chain().focus().setParagraph().run()} active={editor.isActive("paragraph")} title="Paragraph">
            <Type size={16} />
          </MenuButton>
          <MenuButton onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive("heading", { level: 1 })} title="H1">
            <Heading1 size={16} />
          </MenuButton>
          <MenuButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} title="H2">
            <Heading2 size={16} />
          </MenuButton>
          <MenuButton onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })} title="H3">
            <Heading3 size={16} />
          </MenuButton>

          <div className="mx-1 w-px bg-border" />

          {/* Alignment */}
          <MenuButton onClick={() => editor.chain().focus().setTextAlign("left").run()} active={editor.isActive({ textAlign: "left" })} title="Align left">
            <AlignLeft size={16} />
          </MenuButton>
          <MenuButton onClick={() => editor.chain().focus().setTextAlign("center").run()} active={editor.isActive({ textAlign: "center" })} title="Align center">
            <AlignCenter size={16} />
          </MenuButton>
          <MenuButton onClick={() => editor.chain().focus().setTextAlign("right").run()} active={editor.isActive({ textAlign: "right" })} title="Align right">
            <AlignRight size={16} />
          </MenuButton>
          <MenuButton onClick={() => editor.chain().focus().setTextAlign("justify").run()} active={editor.isActive({ textAlign: "justify" })} title="Justify">
            <AlignJustify size={16} />
          </MenuButton>

          <div className="mx-1 w-px bg-border" />

          {/* Lists */}
          <MenuButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} title="Bullet list">
            <List size={16} />
          </MenuButton>
          <MenuButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} title="Numbered list">
            <ListOrdered size={16} />
          </MenuButton>
          <MenuButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")} title="Quote">
            <Quote size={16} />
          </MenuButton>
          <MenuButton onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Divider">
            <Minus size={16} />
          </MenuButton>

          <div className="mx-1 w-px bg-border" />

          {/* Tables: the controls that alter a table are available only while the cursor is in one. */}
          <MenuButton onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="Insert table (3 columns, 3 rows)">
            <Table size={16} />
          </MenuButton>
          <MenuButton onClick={() => editor.chain().focus().addRowAfter().run()} disabled={!editor.isActive("table")} title="Add table row">
            <Rows3 size={16} />
          </MenuButton>
          <MenuButton onClick={() => editor.chain().focus().addColumnAfter().run()} disabled={!editor.isActive("table")} title="Add table column">
            <Columns3 size={16} />
          </MenuButton>
          <MenuButton onClick={() => editor.chain().focus().deleteTable().run()} disabled={!editor.isActive("table")} title="Delete table">
            <Trash2 size={16} />
          </MenuButton>

          <div className="mx-1 w-px bg-border" />

          {/* Color */}
          <MenuButton onClick={setColor} title="Text color">
            <Palette size={16} />
          </MenuButton>
          <MenuButton onClick={() => undefined} disabled={mapScenes.length === 0} title="Select text and right click to link a map scene">
            <MapPinned size={16} />
          </MenuButton>

          {/* Media */}
        <MenuButton onClick={addImage} title="Upload image">
          <ImageIcon size={16} />
        </MenuButton>
        <MenuButton onClick={addImageFromUrl} title="Image URL">
          <ImageIcon size={16} />
        </MenuButton>
        <MenuButton onClick={addLink} active={editor.isActive("link")} title="Add link">
          <LinkIcon size={16} />
        </MenuButton>
          <MenuButton onClick={addYoutube} title="YouTube video">
            <YoutubeIcon size={16} />
          </MenuButton>

          <div className="mx-1 w-px bg-border" />

          {/* Undo/Redo */}
          <MenuButton onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo">
            <Undo size={16} />
          </MenuButton>
          <MenuButton onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo">
            <Redo size={16} />
          </MenuButton>
        </div>
      </div>

      {/* Editor */}
      <EditorContent editor={editor} />

      {contextMenu && (
        <div
          className="fixed z-[90] min-w-[220px] rounded-xl border border-border bg-background p-2 shadow-[0_18px_40px_rgba(15,23,42,0.18)]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <p className="px-2 py-1 text-[11px] font-sans uppercase tracking-[0.16em] text-muted-foreground">
            Link map scene
          </p>
          <div className="max-h-[240px] overflow-y-auto">
            {mapScenes.map((scene) => (
              <button
                key={scene.id}
                type="button"
                onClick={() => linkSceneToSelection(scene.id)}
                className="flex w-full items-center rounded-md px-2 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted"
              >
                {scene.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,image/gif"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) {
            void handleMediaFiles(files, pendingInsertPositionRef.current ?? editor.state.selection.from);
          }
          pendingInsertPositionRef.current = null;
          e.target.value = "";
        }}
      />
    </div>
  );
};

export default RichTextEditor;
