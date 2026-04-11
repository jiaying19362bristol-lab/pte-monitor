alter table if exists public.ra_comments
add column if not exists owner_token text;

create index if not exists ra_comments_owner_token_idx
on public.ra_comments (owner_token);

create index if not exists ra_comments_recording_owner_idx
on public.ra_comments (recording_id, owner_token);

-- Optional RLS policies. Enable and adjust only if your project uses RLS for public comment access.
-- alter table public.ra_comments enable row level security;
--
-- create policy "ra_comments_select_all"
-- on public.ra_comments
-- for select
-- using (true);
--
-- create policy "ra_comments_insert_any"
-- on public.ra_comments
-- for insert
-- with check (true);
--
-- create policy "ra_comments_delete_by_owner_token"
-- on public.ra_comments
-- for delete
-- using (owner_token is not null);
