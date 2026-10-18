// ลูกค้าส่งเอกสารแล้ว → แจ้ง admin ทาง LINE
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { ADMIN_URL, card, pushLine } from "../_shared/line.ts";
import { DOC_LABEL, thYear } from "../_shared/doctypes.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  let b: { document_id?: string };
  try { b = await req.json(); } catch { return json(req, { error: "bad_json" }, 400); }
  if (!b.document_id) return json(req, { error: "validation" }, 422);

  // RLS: ลูกค้าเห็นได้เฉพาะเอกสารของตัวเอง
  const { data: d } = await userClient.from("documents")
    .select("id, client_id, doc_type, tax_year, created_at").eq("id", b.document_id).maybeSingle();
  if (!d) return json(req, { error: "not_found" }, 404);
  if (Date.now() - new Date(d.created_at).getTime() > 10 * 60 * 1000) return json(req, { ok: true, skipped: "old" });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { count } = await admin.from("notifications").select("id", { count: "exact", head: true })
    .eq("client_id", d.client_id).eq("kind", "doc_uploaded").gte("created_at", new Date(Date.now() - 2 * 60 * 1000).toISOString());
  // กันส่งถี่: 1 ข้อความต่อลูกค้าต่อ 2 นาที
  if ((count ?? 0) > 0) return json(req, { ok: true, skipped: "throttled" });

  const [{ data: c }, { data: admins }] = await Promise.all([
    admin.from("clients").select("client_code, first_name, last_name").eq("id", d.client_id).single(),
    admin.from("admins").select("line_user_id").not("line_user_id", "is", null),
  ]);
  for (const a of admins ?? []) {
    await pushLine(admin, a.line_user_id!, [card("เอกสารใหม่รอตรวจ 📄", [
      `${c?.client_code ?? ""} ${c?.first_name ?? ""} ${c?.last_name ?? ""}`.trim(),
      `${DOC_LABEL[d.doc_type] ?? d.doc_type} · ปีภาษี ${thYear(d.tax_year)}`,
    ], { label: "เปิดหลังบ้าน", uri: ADMIN_URL })], { client_id: d.client_id, recipient: "admin", kind: "doc_uploaded" });
  }
  return json(req, { ok: true });
});
