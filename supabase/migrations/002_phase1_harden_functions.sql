-- ย้ายฟังก์ชันช่วยของ RLS ไป schema private (ไม่เปิดผ่าน API) + ปิด rls_auto_enable จาก API
-- (applied to ufjxykraeybvvoaxdopn on 2026-10-19)
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter function public.is_admin() set schema private;
alter function public.current_client_id() set schema private;
alter function public.log_change() set schema private;
alter function public.protect_client_columns() set schema private;

create or replace function private.protect_client_columns() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' and not private.is_admin() then
    if (new.auth_user_id, new.line_user_id, new.client_code, new.title, new.first_name, new.last_name,
        new.birth_date, new.status)
       is distinct from
       (old.auth_user_id, old.line_user_id, old.client_code, old.title, old.first_name, old.last_name,
        old.birth_date, old.status) then
      raise exception 'not allowed to change protected fields';
    end if;
  end if;
  if (new.national_id_enc, new.national_id_hash, new.national_id_last4)
     is distinct from (old.national_id_enc, old.national_id_hash, old.national_id_last4)
     and coalesce(current_setting('app.nid_update', true), 'off') <> 'on'
     and coalesce(auth.role(), '') in ('authenticated','anon') then
    raise exception 'use set_national_id()';
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.set_national_id(p_client uuid, p_nid text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare k text;
begin
  if auth.uid() is null or not (private.is_admin() or p_client = private.current_client_id()) then
    raise exception 'forbidden';
  end if;
  if p_nid !~ '^\d{13}$' then raise exception 'invalid national id'; end if;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'pii_key';
  perform set_config('app.nid_update', 'on', true);
  update public.clients
     set national_id_enc   = pgp_sym_encrypt(p_nid, k),
         national_id_hash  = encode(hmac(p_nid, k, 'sha256'), 'hex'),
         national_id_last4 = right(p_nid, 4)
   where id = p_client;
  perform set_config('app.nid_update', 'off', true);
end $$;

create or replace function public.get_national_id(p_client uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare k text; v text;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'forbidden'; end if;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'pii_key';
  select pgp_sym_decrypt(national_id_enc, k) into v from public.clients where id = p_client;
  insert into public.audit_logs(actor_id, action, table_name, record_id, client_id)
  values (auth.uid(), 'view_pii', 'clients', p_client, p_client);
  return v;
end $$;

revoke all on function public.set_national_id(uuid, text) from public, anon;
revoke all on function public.get_national_id(uuid) from public, anon;
grant execute on function public.set_national_id(uuid, text) to authenticated;
grant execute on function public.get_national_id(uuid) to authenticated;
revoke all on function private.log_change() from public, anon, authenticated;
revoke all on function private.protect_client_columns() from public, anon, authenticated;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
