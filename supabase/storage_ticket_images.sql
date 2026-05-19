-- Create public bucket for ticket images (safe for viewing from phone/PC)
insert into storage.buckets (id, name, public)
values ('ticket-images', 'ticket-images', true)
on conflict (id) do update set public = true;

-- Allow authenticated users to upload only into their own folder: <uid>/...
drop policy if exists "ticket-images insert own folder" on storage.objects;
create policy "ticket-images insert own folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'ticket-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow authenticated users to update only their own uploaded files
drop policy if exists "ticket-images update own folder" on storage.objects;
create policy "ticket-images update own folder"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'ticket-images'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'ticket-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow authenticated users to delete only their own uploaded files
drop policy if exists "ticket-images delete own folder" on storage.objects;
create policy "ticket-images delete own folder"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'ticket-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Public read (because bucket is public). Optional explicit select policy:
drop policy if exists "ticket-images public read" on storage.objects;
create policy "ticket-images public read"
on storage.objects
for select
to public
using (bucket_id = 'ticket-images');
