alter table public.admins add column if not exists line_user_id text;
alter table public.admins add column if not exists notify_new_client boolean not null default true;

-- ผูก LINE ของ owner จากบัญชีลูกค้า MC69-0001
update public.admins a set line_user_id = c.line_user_id
from public.clients c
where c.client_code = 'MC69-0001' and a.role = 'owner' and a.line_user_id is null;

create table if not exists public.notifications (
  id          bigint generated always as identity primary key,
  client_id   uuid references public.clients(id) on delete set null,
  recipient   text not null check (recipient in ('client','admin')),
  kind        text not null,
  ok          boolean not null,
  error       text,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_client_idx on public.notifications (client_id, created_at);
alter table public.notifications enable row level security;
create policy notifications_admin_read on public.notifications for select to authenticated using ((select private.is_admin()));
grant select on public.notifications to authenticated;
grant all on public.notifications to service_role;
