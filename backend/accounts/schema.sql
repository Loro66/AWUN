-- Run in the Supabase SQL editor before enabling SONGVALE accounts.
create table if not exists public.songvale_library (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision integer not null default 1 check (revision > 0),
  library jsonb not null default '[]'::jsonb check (jsonb_typeof(library) = 'array'),
  playlists jsonb not null default '[]'::jsonb check (jsonb_typeof(playlists) = 'array')
);

alter table public.songvale_library enable row level security;
revoke all on public.songvale_library from anon;
grant select, insert, update on public.songvale_library to authenticated;

drop policy if exists "songvale_select_own" on public.songvale_library;
drop policy if exists "songvale_insert_own" on public.songvale_library;
drop policy if exists "songvale_update_own" on public.songvale_library;
create policy "songvale_select_own" on public.songvale_library
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "songvale_insert_own" on public.songvale_library
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "songvale_update_own" on public.songvale_library
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
