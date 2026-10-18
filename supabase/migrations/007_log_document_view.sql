-- บันทึกทุกครั้งที่ admin เปิดดูไฟล์เอกสารลูกค้า
create or replace function public.log_document_view(p_document uuid) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  select client_id into cid from public.documents where id = p_document;
  if cid is null then raise exception 'not found'; end if;
  insert into public.audit_logs(actor_id, action, table_name, record_id, client_id)
  values (auth.uid(), 'download', 'documents', p_document, cid);
end $$;
revoke all on function public.log_document_view(uuid) from public, anon;
grant execute on function public.log_document_view(uuid) to authenticated;
