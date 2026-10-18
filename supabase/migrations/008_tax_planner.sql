-- ข้อมูลวางแผนภาษีที่ลูกค้ากรอกเอง (1 แถวต่อลูกค้าต่อปีภาษี)
create table public.client_tax_inputs (
  client_id   uuid not null references public.clients(id) on delete cascade,
  tax_year    int  not null,
  inputs      jsonb not null,
  result      jsonb,
  updated_at  timestamptz not null default now(),
  primary key (client_id, tax_year)
);
alter table public.client_tax_inputs enable row level security;
create policy cti_admin on public.client_tax_inputs for select to authenticated using ((select private.is_admin()));
create policy cti_own_read on public.client_tax_inputs for select to authenticated using (client_id = (select private.current_client_id()));
create policy cti_own_insert on public.client_tax_inputs for insert to authenticated with check (client_id = (select private.current_active_client_id()));
create policy cti_own_update on public.client_tax_inputs for update to authenticated
  using (client_id = (select private.current_active_client_id())) with check (client_id = (select private.current_active_client_id()));
grant select, insert, update on public.client_tax_inputs to authenticated;
grant all on public.client_tax_inputs to service_role;
create trigger audit_tax_inputs after insert or update or delete on public.client_tax_inputs
  for each row execute function private.log_change();

-- ลูกค้ากด "ขอคำปรึกษา" เรื่องลดหย่อน (insert ผ่าน edge function lead-request เท่านั้น)
create table public.lead_requests (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  tax_year    int,
  topic       text not null,
  est_saving  int,
  status      text not null default 'new' check (status in ('new','contacted','closed')),
  note        text,
  created_at  timestamptz not null default now()
);
create index on public.lead_requests (status, created_at);
create index on public.lead_requests (client_id);
alter table public.lead_requests enable row level security;
create policy leads_admin on public.lead_requests for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy leads_own_read on public.lead_requests for select to authenticated using (client_id = (select private.current_client_id()));
grant select, insert, update on public.lead_requests to authenticated;
grant all on public.lead_requests to service_role;
create trigger audit_leads after insert or update or delete on public.lead_requests
  for each row execute function private.log_change();
