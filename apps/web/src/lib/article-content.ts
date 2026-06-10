import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Youtube from "@tiptap/extension-youtube";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import { MediaFigure } from "@/lib/article-media";
import { ArticleMapSceneAnchor } from "@/lib/article-map-anchor";

export const articleContentExtensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
  MediaFigure,
  ArticleMapSceneAnchor,
  Image,
  Link,
  Youtube.configure({ width: 640, height: 360, nocookie: true }),
  TextStyle,
  Color,
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  Underline,
];
