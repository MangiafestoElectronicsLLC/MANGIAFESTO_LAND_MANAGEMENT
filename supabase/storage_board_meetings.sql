-- Create public bucket for saved board meeting recordings
insert into storage.buckets (id, name, public)
values ('board-meetings', 'board-meetings', true)
on conflict (id) do update set public = true;

-- Allow authenticated users to upload only into their own folder: <uid>/...
drop policy if exists "board-meetings insert own folder" on storage.objects;
create policy "board-meetings insert own folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'board-meetings'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow authenticated users to update only their own uploaded files
drop policy if exists "board-meetings update own folder" on storage.objects;
create policy "board-meetings update own folder"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'board-meetings'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'board-meetings'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow authenticated users to delete only their own uploaded files
drop policy if exists "board-meetings delete own folder" on storage.objects;
create policy "board-meetings delete own folder"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'board-meetings'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Public read for saved recordings
drop policy if exists "board-meetings public read" on storage.objects;
create policy "board-meetings public read"
on storage.objects
for select
to public
using (bucket_id = 'board-meetings');