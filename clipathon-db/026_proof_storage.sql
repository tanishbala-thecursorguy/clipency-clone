-- ============================================================
-- 026 · Storage for proof, and the raw bucket that was never made
-- ============================================================
-- proof_image tasks need somewhere to put the screenshot. While we are here,
-- clipathon-raw has been referenced by the upload-raw task since 010 and has
-- never existed, so every raw upload would have failed at the first attempt.
--
-- Both buckets are private. The first folder in the object name is the
-- uploader's auth uid, which is what the policies key off, so one creator
-- cannot read or overwrite another creator's file.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('clipathon-proof', 'clipathon-proof', false, 10485760,
   array['image/png','image/jpeg','image/webp']),
  ('clipathon-raw',   'clipathon-raw',   false, 1073741824,
   array['video/mp4','video/quicktime'])
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public             = excluded.public;

drop policy if exists clipathon_uploads_insert on storage.objects;
create policy clipathon_uploads_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('clipathon-proof','clipathon-raw')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists clipathon_uploads_read on storage.objects;
create policy clipathon_uploads_read on storage.objects
  for select to authenticated
  using (
    bucket_id in ('clipathon-proof','clipathon-raw')
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or clipathon.is_admin()
    )
  );

-- A creator may replace their own file before review, which is the difference
-- between a wrong screenshot and a support ticket. They may not delete.
drop policy if exists clipathon_uploads_update on storage.objects;
create policy clipathon_uploads_update on storage.objects
  for update to authenticated
  using      (bucket_id in ('clipathon-proof','clipathon-raw') and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id in ('clipathon-proof','clipathon-raw') and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists clipathon_uploads_admin_delete on storage.objects;
create policy clipathon_uploads_admin_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('clipathon-proof','clipathon-raw')
    and clipathon.has_role(array['ops']::clipathon.admin_role[])
  );
