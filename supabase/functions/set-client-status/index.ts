// admin เปลี่ยนสถานะลูกค้า (อนุมัติ/ระงับ) + ออกรหัสลูกค้า + แจ้งลูกค้าทาง LINE
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { card, LIFF_URL, pushLine } from "../_shared/line.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const BILLING_REMIND_AT = 20;

async function nextCode(admin: ReturnType<typeof createClient>): Promise<string> {
  const y = (new Date().getFullYear() + 543) % 100;
  const { data } = await admin.from("clients").select("client_code")
    .like("client_code", `MC${y}-%`).order("client_code", { ascending: false }).limit(1);
  const n = data?.[0]?.client_code ? parseInt(data[0].client_code.split("-")[1], 10) + 1 : 1;
  return `MC${y}-${String(n).padStart(4, "0")}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  // ทำงานในสิทธิ์ของ admin ที่ล็อกอิน (ต้องผ่าน 2FA แล้ว)
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const { data: st } = await userClient.rpc("admin_status");
  if (st !== "ok") return json(req, { error: "forbidden" }, 403);

  let b: { client_id?: string; status?: string; notify?: boolean };
  try { b = await req.json(); } catch { return json(req, { error: "bad_json" }, 400); }
  if (!b.client_id || !["active", "inactive"].includes(b.status ?? "")) return json(req, { error: "validation" }, 422);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: c, error: gErr } = await userClient.from("clients")
    .select("id, status, client_code, first_name, line_user_id").eq("id", b.client_id).single();
  if (gErr || !c) return json(req, { error: "not_found" }, 404);
  if (c.status === b.status) return json(req, { ok: true, unchanged: true, client_code: c.client_code });

  const patch: Record<string, string> = { status: b.status! };
  let updErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (b.status === "active" && !c.client_code) patch.client_code = await nextCode(admin);
    // อัปเดตด้วยสิทธิ์ admin เพื่อให้ audit log บันทึกว่าใครเป็นคนอนุมัติ
    const { error } = await userClient.from("clients").update(patch).eq("id", c.id);
    updErr = error;
    if (!error || !/duplicate|unique/i.test(error.message)) break;
  }
  if (updErr) return json(req, { error: "update_failed", detail: updErr.message }, 500);

  let notified = false;
  if (b.notify !== false && c.line_user_id) {
    const code = patch.client_code ?? c.client_code;
    const msg = b.status === "active"
      ? card("อนุมัติการใช้บริการแล้ว ✅", [
          `เรียนคุณ${c.first_name}`,
          `รหัสลูกค้าของท่าน: ${code}`,
          "ท่านสามารถส่งเอกสารและติดตามสถานะภาษีผ่าน LINE นี้ได้ทันที",
        ], { label: "เปิดบัญชีของฉัน", uri: LIFF_URL })
      : card("บัญชีถูกระงับชั่วคราว", [
          `เรียนคุณ${c.first_name}`,
          "บัญชีของท่านถูกระงับชั่วคราว หากมีข้อสงสัยกรุณาตอบกลับในแชทนี้",
        ], undefined, "#8a5a00");
    notified = await pushLine(admin, c.line_user_id, [msg],
      { client_id: c.id, recipient: "client", kind: `status_${b.status}` });
  }

  // เตือนตั้งบิล Gemini (แบบเสียเงิน) ครั้งเดียว เมื่อลูกค้าใช้งานเกิน 20 คน
  if (b.status === "active") {
    const { count } = await admin.from("clients").select("id", { count: "exact", head: true }).eq("status", "active");
    if ((count ?? 0) > BILLING_REMIND_AT) {
      const { data: sent } = await admin.from("notifications").select("id").eq("kind", "billing_reminder").eq("ok", true).limit(1);
      if (!sent?.length) {
        const { data: admins } = await admin.from("admins").select("line_user_id").not("line_user_id", "is", null);
        for (const a of admins ?? []) {
          await pushLine(admin, a.line_user_id!, [card("ถึงเวลาตั้งบิล Gemini ⚠️", [
            `ลูกค้าใช้งานครบ ${count} คนแล้ว`,
            "ตอนนี้ AI อ่านเอกสาร/แชทบอทยังใช้ Gemini แบบฟรี ซึ่งมีโควตาจำกัดและ Google อาจนำข้อมูลไปใช้ปรับปรุงระบบ",
            "aistudio.google.com → API keys → Set up billing (ใช้ key เดิม ไม่ต้องแก้ระบบ)",
          ], { label: "เปิด AI Studio", uri: "https://aistudio.google.com/apikey" }, "#a9822a")],
            { recipient: "admin", kind: "billing_reminder" });
        }
      }
    }
  }

  return json(req, { ok: true, client_code: patch.client_code ?? c.client_code, notified });
});
