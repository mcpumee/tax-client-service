-- ทดสอบสิทธิ์ (RLS) — รันใน Supabase SQL Editor
-- ทุกอย่างอยู่ใน transaction และ ROLLBACK ตอนท้าย ไม่มีข้อมูลค้าง
begin;
create temp table r(t text, expect text, got text) on commit drop;
grant all on r to authenticated, anon;

insert into auth.users(id, instance_id, aud, role, email) values
 ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t1@test.local'),
 ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t2@test.local'),
 ('33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t3@test.local');
insert into public.admins(user_id) values ('33333333-3333-3333-3333-333333333333');
insert into public.clients(id, auth_user_id, first_name, last_name) values
 ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Test','One'),
 ('aaaaaaaa-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','Test','Two');

-- ===== ลูกค้าทดสอบ 1 =====
select set_config('request.jwt.claims','{"role":"authenticated","sub":"11111111-1111-1111-1111-111111111111","aal":"aal1"}',true);
set local role authenticated;
insert into r select 'T1 ลูกค้าเห็นข้อมูลลูกค้า (เฉพาะตัวเอง)', '1', count(*)::text from public.clients;
select public.set_national_id('aaaaaaaa-0000-0000-0000-000000000001','1101700230708');
insert into r select 'T2 ตั้งเลข ปชช. ของตัวเอง (4 ตัวท้าย)', '0708', national_id_last4 from public.clients;
update public.clients set phone='0812345678';
insert into r select 'T3 แก้เบอร์โทรตัวเอง', '0812345678', phone from public.clients;
with u as (update public.clients set phone='0000000000' where id='aaaaaaaa-0000-0000-0000-000000000002' returning 1)
 insert into r select 'T4 แก้ข้อมูลลูกค้าคนอื่น (แถว)', '0', count(*)::text from u;
insert into public.documents(client_id, category, doc_type, file_path, tax_year)
 values ('aaaaaaaa-0000-0000-0000-000000000001','income','50tawi','aaaaaaaa-0000-0000-0000-000000000001/2026/income/a.pdf',2026);
with d as (delete from public.documents returning 1)
 insert into r select 'T5 ลูกค้าลบเอกสารตัวเอง (แถว)', '0', count(*)::text from d;
insert into r select 'T6 ลูกค้าเห็น audit log', '0', count(*)::text from public.audit_logs;
insert into r select 'T7 ลูกค้าเห็นรายชื่อ admin คนอื่น', '0', count(*)::text from public.admins;
reset role;

-- ===== admin ยังไม่ผ่าน 2FA (aal1) =====
select set_config('request.jwt.claims','{"role":"authenticated","sub":"33333333-3333-3333-3333-333333333333","aal":"aal1"}',true);
set local role authenticated;
insert into r select 'T8 admin ที่ยังไม่ผ่าน 2FA เห็นลูกค้า', '0', count(*)::text from public.clients;
reset role;

-- ===== admin ผ่าน 2FA (aal2) =====
select set_config('request.jwt.claims','{"role":"authenticated","sub":"33333333-3333-3333-3333-333333333333","aal":"aal2"}',true);
set local role authenticated;
insert into r select 'T9 admin (2FA) เห็นลูกค้าทดสอบทั้ง 2 คน', '2', count(*)::text from public.clients where id::text like 'aaaaaaaa-%';
insert into r select 'T10 admin ถอดรหัสเลข ปชช. ได้ถูกต้อง', 'true',
  (public.get_national_id('aaaaaaaa-0000-0000-0000-000000000001')='1101700230708')::text;
insert into r select 'T11 การดูเลข ปชช. ถูกบันทึก audit', '1',
  count(*)::text from public.audit_logs where action='view_pii' and client_id='aaaaaaaa-0000-0000-0000-000000000001';
reset role;

-- ===== ไม่ได้ล็อกอิน (anon) =====
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
insert into r select 'T12 คนไม่ล็อกอินอ่านตารางลูกค้าได้', 'false', has_table_privilege('anon','public.clients','select')::text;
insert into r select 'T13 คนไม่ล็อกอินถอดรหัสเลข ปชช. ได้', 'false', has_function_privilege('anon','public.get_national_id(uuid)','execute')::text;
reset role;

select t as "การทดสอบ", expect as "ควรได้", got as "ได้จริง",
       case when expect = got then '✅ ผ่าน' else '❌ ไม่ผ่าน' end as "ผล"
from r;
rollback;
