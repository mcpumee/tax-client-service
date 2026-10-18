-- Tax Client Service — Phase 1: ลูกค้า, ครอบครัว, consent, เอกสาร, audit log
-- (applied to ufjxykraeybvvoaxdopn as migration "phase1_core")
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'pii_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'pii_key', 'PII encryption key');
  end if;
end $$;

create table public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null default 'owner' check (role in ('owner','staff')),
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create table public.clients (
  id                 uuid primary key default gen_random_uuid(),
  auth_user_id       uuid unique references auth.users(id) on delete set null,
  line_user_id       text unique,
  client_code        text unique,
  title              text,
  first_name         text not null,
  last_name          text not null,
  national_id_enc    bytea,
  national_id_hash   text unique,
  national_id_last4  text,
  birth_date         date,
  phone              text,
  email              text,
  address            text,
  marital_status     text check (marital_status in ('single','married','divorced','widowed')),
  status             text not null default 'pending' check (status in ('pending','active','inactive')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create or replace function public.current_client_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.clients where auth_user_id = auth.uid();
$$;

create table public.family_members (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  relation      text not null check (relation in ('spouse','child','father','mother','spouse_father','spouse_mother','disabled_dependent')),
  full_name     text not null,
  birth_date    date,
  has_income    boolean,
  is_disabled   boolean not null default false,
  note          text,
  created_at    timestamptz not null default now()
);
create index on public.family_members (client_id);

create table public.consents (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  consent_type  text not null check (consent_type in ('tax_service','cross_border_storage','marketing_insurance')),
  version       text not null,
  granted       boolean not null,
  granted_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  channel       text not null default 'liff' check (channel in ('liff','line_chat','admin'))
);
create index on public.consents (client_id);

create table public.documents (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients(id) on delete restrict,
  tax_year        int,
  category        text not null check (category in ('identity','income','expense','deduction','filing','insurance','other')),
  doc_type        text not null,
  file_path       text not null,
  mime_type       text,
  extracted_data  jsonb,
  status          text not null default 'pending_review' check (status in ('pending_review','confirmed','rejected')),
  version         int not null default 1,
  replaced_by     uuid references public.documents(id),
  expires_at      date,
  uploaded_by     text not null default 'client' check (uploaded_by in ('client','admin','system')),
  created_at      timestamptz not null default now()
);
create index on public.documents (client_id, tax_year);
create index on public.documents (replaced_by);

create table public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  action      text not null,
  table_name  text,
  record_id   uuid,
  client_id   uuid,
  detail      jsonb,
  created_at  timestamptz not null default now()
);
create index on public.audit_logs (client_id, created_at);

create or replace function public.log_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare rec jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.audit_logs(actor_id, action, table_name, record_id, client_id)
  values (auth.uid(), lower(tg_op), tg_table_name, (rec->>'id')::uuid,
          coalesce((rec->>'client_id')::uuid, case when tg_table_name='clients' then (rec->>'id')::uuid end));
  return coalesce(new, old);
end $$;

create trigger audit_clients   after insert or update or delete on public.clients        for each row execute function public.log_change();
create trigger audit_family    after insert or update or delete on public.family_members for each row execute function public.log_change();
create trigger audit_consents  after insert or update or delete on public.consents       for each row execute function public.log_change();
create trigger audit_documents after insert or update or delete on public.documents      for each row execute function public.log_change();

create or replace function public.set_national_id(p_client uuid, p_nid text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare k text;
begin
  if not (public.is_admin() or p_client = public.current_client_id()) then
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
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'pii_key';
  select pgp_sym_decrypt(national_id_enc, k) into v from public.clients where id = p_client;
  insert into public.audit_logs(actor_id, action, table_name, record_id, client_id)
  values (auth.uid(), 'view_pii', 'clients', p_client, p_client);
  return v;
end $$;

create or replace function public.protect_client_columns() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' and not public.is_admin() then
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
create trigger clients_protect before update on public.clients
  for each row execute function public.protect_client_columns();

revoke all on function public.log_change() from public, anon, authenticated;
revoke all on function public.protect_client_columns() from public, anon, authenticated;
revoke all on function public.get_national_id(uuid) from public, anon;
revoke all on function public.set_national_id(uuid, text) from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.current_client_id() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.current_client_id() to authenticated;
grant execute on function public.set_national_id(uuid, text) to authenticated;
grant execute on function public.get_national_id(uuid) to authenticated;

alter table public.admins         enable row level security;
alter table public.clients        enable row level security;
alter table public.family_members enable row level security;
alter table public.consents       enable row level security;
alter table public.documents      enable row level security;
alter table public.audit_logs     enable row level security;

create policy admins_self on public.admins for select to authenticated using (user_id = (select auth.uid()));

create policy clients_admin on public.clients for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy clients_own_read on public.clients for select to authenticated using (auth_user_id = (select auth.uid()));
create policy clients_own_update on public.clients for update to authenticated using (auth_user_id = (select auth.uid())) with check (auth_user_id = (select auth.uid()));

create policy family_admin on public.family_members for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy family_own on public.family_members for all to authenticated
  using (client_id = (select public.current_client_id())) with check (client_id = (select public.current_client_id()));

create policy consents_admin on public.consents for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy consents_own_read on public.consents for select to authenticated using (client_id = (select public.current_client_id()));
create policy consents_own_insert on public.consents for insert to authenticated with check (client_id = (select public.current_client_id()));

create policy docs_admin on public.documents for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy docs_own_read on public.documents for select to authenticated using (client_id = (select public.current_client_id()));
create policy docs_own_insert on public.documents for insert to authenticated
  with check (client_id = (select public.current_client_id()) and uploaded_by = 'client' and status = 'pending_review');

create policy audit_admin_read on public.audit_logs for select to authenticated using ((select public.is_admin()));

revoke all on all tables in schema public from anon, authenticated;
grant select (id, auth_user_id, line_user_id, client_code, title, first_name, last_name,
              national_id_last4, birth_date, phone, email, address, marital_status,
              status, created_at, updated_at) on public.clients to authenticated;
grant insert (auth_user_id, line_user_id, client_code, title, first_name, last_name, birth_date,
              phone, email, address, marital_status, status) on public.clients to authenticated;
grant update (phone, email, address, marital_status, auth_user_id, line_user_id, client_code, title,
              first_name, last_name, birth_date, status) on public.clients to authenticated;
grant delete on public.clients to authenticated;
grant select, insert, update, delete on public.family_members to authenticated;
grant select, insert, update on public.consents to authenticated;
grant select, insert, update, delete on public.documents to authenticated;
grant select on public.audit_logs to authenticated;
grant select on public.admins to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-docs', 'client-docs', false, 20971520,
        array['image/jpeg','image/png','image/heic','image/webp','application/pdf'])
on conflict (id) do nothing;

create policy storage_admin on storage.objects for all to authenticated
  using (bucket_id = 'client-docs' and (select public.is_admin()))
  with check (bucket_id = 'client-docs' and (select public.is_admin()));

create policy storage_own_read on storage.objects for select to authenticated
  using (bucket_id = 'client-docs' and (storage.foldername(name))[1] = (select public.current_client_id())::text);

create policy storage_own_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'client-docs' and (storage.foldername(name))[1] = (select public.current_client_id())::text);
