// ลูกค้ากด "ขอคำปรึกษา" ลดหย่อน → บันทึก lead + แจ้ง admin ทาง LINE
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { ADMIN_URL, card, pushLine } from "../_shared/line.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const TOPICS: Record<string, string> = {
  life: "ประกันชีวิต / สะสมทรัพย์", health: "ประกันสุขภาพ", parentHealth: "ประกันสุขภาพบิดามารดา",
  spouseLife: "ประกันชีวิตคู่สมรส", pension: "ประกันบำนาญ", general: "วางแผนลดหย่อนภาษี",
  rmf: "กองทุน RMF", esgx: "กองทุน Thai ESGX", pvd: "PVD / กบข.",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const { data: c } = await userClient.from("clients")
    .select("id, client_code, first_name, last_name, phone, status").maybeSingle();
  if (!c || c.status !== "active") return json(req, { error: "forbidden" }, 403);

  let b: { topic?: string; tax_year?: number; est_saving?: number };
  try { b = await req.json(); } catch { return json(req, { error: "bad_json" }, 400); }
  const topic = TOPICS[b.topic ?? ""] ? b.topic! : "general";
  const save = Math.max(0, Math.min(5_000_000, Math.round(Number(b.est_saving) || 0)));

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  // กันกดซ้ำ: หัวข้อเดิมภายใน 24 ชม.
  const { data: dup } = await admin.from("lead_requests").select("id").eq("client_id", c.id).eq("topic", topic)
    .gte("created_at", new Date(Date.now() - 86400000).toISOString()).limit(1);
  if (dup?.length) return json(req, { ok: true, duplicate: true });

  await admin.from("lead_requests").insert({ client_id: c.id, tax_year: b.tax_year ?? null, topic, est_saving: save || null });
  const { data: admins } = await admin.from("admins").select("line_user_id").not("line_user_id", "is", null);
  for (const a of admins ?? []) {
    await pushLine(admin, a.line_user_id!, [card("ลูกค้าขอคำปรึกษาลดหย่อน 💡", [
      `${c.client_code ?? ""} ${c.first_name} ${c.last_name}`.trim(),
      `เรื่อง: ${TOPICS[topic]}`,
      save ? `ประหยัดภาษีได้ประมาณ ${save.toLocaleString("th-TH")} บาท` : "",
      c.phone ? `โทร ${c.phone}` : "",
    ].filter(Boolean), { label: "เปิดหลังบ้าน", uri: ADMIN_URL }, "#a9822a")], { client_id: c.id, recipient: "admin", kind: "lead" });
  }
  return json(req, { ok: true });
});
