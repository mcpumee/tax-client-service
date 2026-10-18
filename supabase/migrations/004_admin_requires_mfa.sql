-- admin มีสิทธิ์ก็ต่อเมื่อล็อกอินแบบ 2FA (aal2) แล้วเท่านั้น
create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
     and coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2';
$$;

create or replace function public.admin_status() returns text
language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from public.admins where user_id = auth.uid()) then 'not_admin'
    when coalesce(auth.jwt()->>'aal', 'aal1') <> 'aal2' then 'need_mfa'
    else 'ok' end;
$$;
revoke all on function public.admin_status() from public, anon;
grant execute on function public.admin_status() to authenticated;

create or replace function public.admin_summary() returns json
language sql stable security definer set search_path = public as $$
  select case when private.is_admin() then json_build_object(
    'pending',  (select count(*) from public.clients where status='pending'),
    'active',   (select count(*) from public.clients where status='active'),
    'inactive', (select count(*) from public.clients where status='inactive'),
    'docs_pending', (select count(*) from public.documents where status='pending_review')
  ) end;
$$;
revoke all on function public.admin_summary() from public, anon;
grant execute on function public.admin_summary() to authenticated;
