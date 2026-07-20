alter table public.community_posts
  add column if not exists linked_resources jsonb not null default '[]'::jsonb;

alter table public.community_comments
  add column if not exists linked_resources jsonb not null default '[]'::jsonb;

alter table public.community_posts
  add constraint community_posts_linked_resources_array
  check (jsonb_typeof(linked_resources) = 'array');

alter table public.community_comments
  add constraint community_comments_linked_resources_array
  check (jsonb_typeof(linked_resources) = 'array');

alter table public.community_comments
  drop constraint if exists community_comments_content_check;

alter table public.community_comments
  add constraint community_comments_content_or_reference_check
  check (
    char_length(trim(content)) between 1 and 4000
    or jsonb_array_length(linked_resources) > 0
  );
