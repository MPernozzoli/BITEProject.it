update public.community_posts
set
  visibility = 'public',
  min_tier_id = null,
  updated_at = timezone('utc', now())
where metadata ? 'source_article_id';
