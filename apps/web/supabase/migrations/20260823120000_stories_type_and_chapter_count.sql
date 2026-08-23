-- Add story type (open/closed) and target chapter count for closed stories.
-- Open stories: undefined number of articles (default).
-- Closed stories: a target number of chapters that can be updated later.

alter table public.stories
  add column type text not null default 'open',
  add column target_chapter_count integer;

-- Constrain type to valid values
alter table public.stories
  add constraint stories_type_check check (type in ('open', 'closed'));
