-- Create public bucket for property map base images
insert into storage.buckets (id, name, public)
values ('property-maps', 'property-maps', true)
on conflict (id) do update set public = true;

-- Allow authenticated users to upload only into their own folder: <uid>/...
drop policy if exists "property-maps insert own folder" on storage.objects;
create policy "property-maps insert own folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'property-maps'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow authenticated users to update only their own uploaded files
drop policy if exists "property-maps update own folder" on storage.objects;
create policy "property-maps update own folder"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'property-maps'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'property-maps'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow authenticated users to delete only their own uploaded files
drop policy if exists "property-maps delete own folder" on storage.objects;
create policy "property-maps delete own folder"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'property-maps'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Public read for image display
drop policy if exists "property-maps public read" on storage.objects;
create policy "property-maps public read"
on storage.objects
for select
to public
using (bucket_id = 'property-maps');
