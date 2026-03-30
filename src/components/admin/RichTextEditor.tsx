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
import { useCallback, useEffect, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { MediaFigure, type MediaFigureAttrs } from "@/lib/article-media";
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Quote, Minus, Undo, Redo,
  Image as ImageIcon, Link as LinkIcon, Youtube as YoutubeIcon,
  Type, Heading1, Heading2, Heading3, Palette, Code,
} from "lucide-react";

interface RichTextEditorProps {
  content: unknown;
  onChange: (content: object) => void;
  onHtmlChange?: (html: string) => void;
  placeholder?: string;
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

const RichTextEditor = ({ content, onChange, onHtmlChange, placeholder = "Start writing..." }: RichTextEditorProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingInsertPositionRef = useRef<number | null>(null);
  const normalizedContent = useMemo(() => normalizeEditorContent(content), [content]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      MediaFigure,
      Image.configure({ inline: false, allowBase64: true }),
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "text-accent underline" } }),
      Youtube.configure({ width: 640, height: 360, nocookie: true }),
      TextStyle,
      Color,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Underline,
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
          "article-rich-body prose prose-lg max-w-none focus:outline-none min-h-[300px] p-4 font-sans [&_p]:min-h-[1em]",
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

    editor.commands.setContent(normalizedContent, { emitUpdate: false } as any);
  }, [editor, normalizedContent]);

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

  if (!editor) return null;

  return (
    <div className="border border-border rounded-sm bg-background">
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

          {/* Color */}
          <MenuButton onClick={setColor} title="Text color">
            <Palette size={16} />
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
