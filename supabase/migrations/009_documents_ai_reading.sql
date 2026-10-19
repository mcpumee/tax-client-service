-- ผลการอ่านเอกสารด้วย AI (เป็นแค่ค่าแนะนำ — ตัวเลขจริงอยู่ใน extracted_data หลังเจ้าหน้าที่ยืนยัน)
alter table public.documents add column if not exists ai_status text check (ai_status in ('pending','done','error','skipped'));
alter table public.documents add column if not exists ai_doc_type text;
alter table public.documents add column if not exists ai_confidence numeric(3,2);
alter table public.documents add column if not exists ai_data jsonb;
alter table public.documents add column if not exists ai_issues jsonb;
alter table public.documents add column if not exists ai_at timestamptz;

-- ลูกค้าห้ามใส่ผล AI เอง (ต้องมาจาก edge function เท่านั้น)
alter policy docs_own_insert on public.documents
  with check (client_id = (select private.current_active_client_id())
              and uploaded_by = 'client' and status = 'pending_review'
              and extracted_data is null and replaced_by is null
              and ai_status is null and ai_data is null and ai_issues is null and ai_doc_type is null
              and file_path like client_id::text || '/%');
