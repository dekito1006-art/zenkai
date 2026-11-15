-- Zenkai – Tabelle für den Sync zwischen Geräten.
-- In Supabase: SQL Editor → New query → diesen Inhalt einfügen → Run.

create table if not exists public.zenkai_data (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data       jsonb not null,
  rev        integer not null default 1,
  updated_at timestamptz not null default now()
);

-- Jeder Nutzer sieht und ändert ausschließlich seine eigenen Daten.
alter table public.zenkai_data enable row level security;

drop policy if exists "zenkai select own" on public.zenkai_data;
drop policy if exists "zenkai insert own" on public.zenkai_data;
drop policy if exists "zenkai update own" on public.zenkai_data;
drop policy if exists "zenkai delete own" on public.zenkai_data;

create policy "zenkai select own" on public.zenkai_data for select to authenticated using (auth.uid() = user_id);
create policy "zenkai insert own" on public.zenkai_data for insert to authenticated with check (auth.uid() = user_id);
create policy "zenkai update own" on public.zenkai_data for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "zenkai delete own" on public.zenkai_data for delete to authenticated using (auth.uid() = user_id);

grant select, insert, update, delete on public.zenkai_data to authenticated;

-- Bilder (Charakter-Porträts, KI-Bilder zu Berichten): privater Speicherordner pro Nutzer.
-- Pfad: zenkai/<user-id>/<bild-id>.jpg – jeder Nutzer sieht nur seinen eigenen Ordner.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('zenkai', 'zenkai', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "zenkai img select own" on storage.objects;
drop policy if exists "zenkai img insert own" on storage.objects;
drop policy if exists "zenkai img update own" on storage.objects;
drop policy if exists "zenkai img delete own" on storage.objects;

create policy "zenkai img select own" on storage.objects for select to authenticated
  using (bucket_id = 'zenkai' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "zenkai img insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'zenkai' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "zenkai img update own" on storage.objects for update to authenticated
  using (bucket_id = 'zenkai' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "zenkai img delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'zenkai' and (storage.foldername(name))[1] = auth.uid()::text);
