-- แชทบอท LINE OA: สถานะบอทต่อผู้ใช้ LINE + เรื่องที่ส่งต่อให้เจ้าหน้าที่
-- เขียนได้เฉพาะ edge function (service_role) — admin อ่าน/ปิดเรื่องได้, ลูกค้าเข้าถึงไม่ได้

create table public.chat_threads (
  line_user_id      text primary key,
  client_id         uuid references public.clients(id) on delete set null,
  bot_paused_until  timestamptz,           -- ระหว่างนี้บอทเงียบ ให้เจ้าหน้าที่คุยเอง
  last_admin_ping   timestamptz,           -- กันแจ้ง admin ถี่เกินไป
  updated_at        timestamptz not null default now()
);

create table public.support_requests (
  id            uuid primary key default gen_random_uuid(),
  line_user_id  text not null,
  client_id     uuid references public.clients(id) on delete set null,
  kind          text not null check (kind in ('tax','staff','app')),
  message       text,                      -- ข้อความลูกค้า (ปิดตัวเลขยาว ๆ แล้ว, ไม่เกิน 500 ตัวอักษร)
  status        text not null default 'new' check (status in ('new','done')),
  created_at    timestamptz not null default now(),
  done_at       timestamptz
);
create index on public.support_requests (status, created_at);
create index on public.support_requests (line_user_id);

alter table public.chat_threads     enable row level security;
alter table public.support_requests enable row level security;

create policy threads_admin on public.chat_threads for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy support_admin on public.support_requests for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

grant select, update on public.chat_threads to authenticated;
grant select, update on public.support_requests to authenticated;
grant all on public.chat_threads, public.support_requests to service_role;

create trigger audit_support after insert or update or delete on public.support_requests
  for each row execute function private.log_change();
