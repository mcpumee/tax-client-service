# Tax Assistance (TA) — ระบบบริการภาษีลูกค้า

ระบบบริการภาษีเงินได้บุคคลธรรมดา (ม.40(1)–(8)) สำหรับลูกค้า ผ่าน LINE OA

- `web/` — หน้าเว็บ (deploy อัตโนมัติขึ้น Netlify: mc-service-tax)
  - `/` หน้าลงทะเบียนลูกค้า (LIFF `2012074785-0ZDimQpy`)
  - `/admin` หลังบ้าน (ล็อกอิน + 2FA บังคับ)
- `supabase/migrations/` — schema ฐานข้อมูล (project `ufjxykraeybvvoaxdopn`, Singapore)
- `supabase/functions/` — Edge Functions: `line-auth`, `register-client`
- `supabase/tests/` — ชุดทดสอบสิทธิ์ (RLS)

ห้าม commit ความลับ (service_role key, LINE channel secret/access token) ลง repo นี้

## Deploy
- Netlify (`mc-service-tax`) เชื่อมกับ branch `main` — push แล้ว deploy อัตโนมัติ (publish: `web`)
- Edge Functions deploy ผ่าน Supabase (ไม่ได้ deploy อัตโนมัติจาก repo)
