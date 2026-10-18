-- ลูกค้าที่อนุมัติแล้ว (active) เท่านั้นที่ส่งเอกสารได้
create or replace function private.current_active_client_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.clients where auth_user_id = auth.uid() and status = 'active';
$$;
revoke all on function private.current_active_client_id() from public, anon;
grant execute on function private.current_active_client_id() to authenticated, service_role;

alter policy docs_own_insert on public.documents
  with check (client_id = (select private.current_active_client_id())
              and uploaded_by = 'client' and status = 'pending_review'
              and extracted_data is null and replaced_by is null
              and file_path like client_id::text || '/%');

alter policy storage_own_upload on storage.objects
  with check (bucket_id = 'client-docs'
              and (storage.foldername(name))[1] = (select private.current_active_client_id())::text);

alter table public.documents add column if not exists original_name text;
alter table public.documents add column if not exists size_bytes int;
alter table public.documents add column if not exists review_note text;
alter table public.documents add column if not exists reviewed_at timestamptz;
alter table public.documents add column if not exists reviewed_by uuid;

create index if not exists documents_status_idx on public.documents (status, created_at);
