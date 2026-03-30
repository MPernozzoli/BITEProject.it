type ArticleInstagramStoryFields = {
  cover_image?: string | null;
  instagram_story_image_en?: string | null;
  instagram_story_image_it?: string | null;
  instagram_story_use_cover_en?: boolean | null;
  instagram_story_use_cover_it?: boolean | null;
};

export const getArticleInstagramStoryImage = (
  article: ArticleInstagramStoryFields | null | undefined,
  lang: "en" | "it"
) => {
  if (!article) return null;

  if (lang === "en") {
    return (article.instagram_story_use_cover_en ?? true)
      ? article.cover_image ?? null
      : article.instagram_story_image_en || article.cover_image || null;
  }

  return (article.instagram_story_use_cover_it ?? true)
    ? article.cover_image ?? null
    : article.instagram_story_image_it || article.cover_image || null;
};
