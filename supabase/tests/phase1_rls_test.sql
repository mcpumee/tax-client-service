-- ทดสอบสิทธิ์เฟส 1 — รันใน Supabase SQL Editor
-- ทุกอย่างอยู่ใน transaction และ ROLLBACK ตอนท้าย ไม่มีข้อมูลค้าง
begin;
create temp table r(t text, v text) on commit drop;
grant all on r to authenticated, anon;

insert into auth.users(id, instance_id, aud, role, email) values
 ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','c1@test.local'),
 ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','c2@test.local'),
 ('33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ad@test.local');
insert into public.admins(user_id) values ('33333333-3333-3333-3333-333333333333');
insert into public.clients(id, auth_user_id, first_name, last_name) values
 ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','A','One'),
 ('aaaaaaaa-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','B','Two');

-- ===== ลูกค้า 1 =====
select set_config('request.jwt.claims','{"role":"authenticated","sub":"11111111-1111-1111-1111-111111111111"}',true);
set local role authenticated;
insert into r select 'T1 ลูกค้าเห็นแค่ตัวเอง (ควร 1)', count(*)::text from public.clients;
select public.set_national_id('aaaaaaaa-0000-0000-0000-000000000001','1234567890123');
insert into r select 'T2 ตั้งเลข ปชช. ตัวเอง (ควร 0123)', national_id_last4 from public.clients;
update public.clients set phone='0812345678';
insert into r select 'T3 แก้เบอร์โทรตัวเอง (ควร 0812345678)', phone from public.clients;
with u as (update public.clients set status='active' where id='aaaaaaaa-0000-0000-0000-000000000002' returning 1)
 insert into r select 'T4 แก้ข้อมูลลูกค้าคนอื่น (ควร 0)', count(*)::text from u;
insert into public.documents(client_id, category, doc_type, file_path, tax_year)
 values ('aaaaaaaa-0000-0000-0000-000000000001','income','50tawi','aaaaaaaa-0000-0000-0000-000000000001/2026/income/a.pdf',2026);
with d as (delete from public.documents returning 1)
 insert into r select 'T5 ลูกค้าลบเอกสาร (ควร 0)', count(*)::text from d;
insert into r select 'T6 ลูกค้าเห็น audit log (ควร 0)', count(*)::text from public.audit_logs;
reset role;

-- ===== admin =====
select set_config('request.jwt.claims','{"role":"authenticated","sub":"33333333-3333-3333-3333-333333333333"}',true);
set local role authenticated;
insert into r select 'T7 admin เห็นลูกค้าทั้งหมด (ควร 2)', count(*)::text from public.clients;
insert into r select 'T8 admin ถอดรหัสถูกต้อง (ควร true)',
  (public.get_national_id('aaaaaaaa-0000-0000-0000-000000000001')='1234567890123')::text;
insert into r select 'T9 การดูเลข ปชช. ถูกบันทึก (ควร 1)', count(*)::text from public.audit_logs where action='view_pii';
reset role;

select * from r;
rollback;
