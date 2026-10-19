// admin ตรวจเอกสาร (ยืนยัน / ให้ส่งใหม่) + แจ้งลูกค้าทาง LINE
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { card, LIFF_URL, pushLine } from "../_shared/line.ts";
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
  const { data: st } = await userClient.rpc("admin_status");
  if (st !== "ok") return json(req, { error: "forbidden" }, 403);
  const { data: { user } } = await userClient.auth.getUser();

  let b: { document_id?: string; status?: string; note?: string; notify?: boolean; data?: Record<string, unknown> };
  try { b = await req.json(); } catch { return json(req, { error: "bad_json" }, 400); }
  if (!b.document_id || !["confirmed", "rejected", "pending_review"].includes(b.status ?? "")) return json(req, { error: "validation" }, 422);
  const note = (b.note ?? "").trim().slice(0, 300) || null;
  if (b.status === "rejected" && !note) return json(req, { error: "note_required" }, 422);

  // ตัวเลขที่เจ้าหน้าที่อ่านจากเอกสาร (ใช้ในหน้าสุขภาพภาษี) — รับเฉพาะคีย์ที่รู้จัก
  const KINDS = ["life", "health", "pension", "parentHealth", "spouseLife", "rmf", "esgx", "pvd", "gor"];
  let extracted: Record<string, unknown> | undefined;
  if (b.status === "confirmed" && b.data && typeof b.data === "object") {
    extracted = {};
    for (const k of ["income", "withheld", "sso", "pvd", "amount"]) {
      const v = Math.round(Number((b.data as Record<string, unknown>)[k]));
      if (Number.isFinite(v) && v > 0 && v < 1e9) extracted[k] = v;
    }
    const kind = String((b.data as Record<string, unknown>).kind ?? "");
    if (KINDS.includes(kind)) extracted.kind = kind;
    if ((b.data as Record<string, unknown>).double === true) extracted.double = true;
    const items = (b.data as Record<string, unknown>).items;
    if (Array.isArray(items)) {
      const clean = items.map((x: any) => ({ kind: String(x?.kind ?? ""), amount: Math.round(Number(x?.amount)) }))
        .filter((x) => KINDS.includes(x.kind) && Number.isFinite(x.amount) && x.amount > 0 && x.amount < 1e9);
      if (clean.length) extracted.items = clean;
    }
    const issuer = (b.data as Record<string, unknown>).issuer;
    if (typeof issuer === "string" && issuer.trim()) extracted.issuer = issuer.trim().slice(0, 120);
  }
  const { data: d, error } = await userClient.from("documents").update({
    status: b.status, review_note: b.status === "rejected" ? note : null,
    reviewed_at: new Date().toISOString(), reviewed_by: user?.id ?? null,
    ...(extracted ? { extracted_data: extracted } : {}),
  }).eq("id", b.document_id).select("id, client_id, doc_type, tax_year").single();
  if (error || !d) return json(req, { error: "update_failed" }, 500);

  let notified = false;
  if (b.notify !== false && b.status !== "pending_review") {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: c } = await admin.from("clients").select("first_name, line_user_id").eq("id", d.client_id).single();
    if (c?.line_user_id) {
      const label = `${DOC_LABEL[d.doc_type] ?? d.doc_type} · ปีภาษี ${thYear(d.tax_year)}`;
      const msg = b.status === "confirmed"
        ? card("ตรวจเอกสารเรียบร้อย ✅", [`เรียนคุณ${c.first_name}`, label, "เอกสารนี้ใช้ยื่นภาษีได้ — อัปเดตสุขภาพภาษีแล้ว"], { label: "ดูสุขภาพภาษี", uri: `${LIFF_URL}?p=health` })
        : card("ขอเอกสารใหม่", [`เรียนคุณ${c.first_name}`, label, `เหตุผล: ${note}`],
            { label: "ส่งเอกสารใหม่", uri: `${LIFF_URL}?p=upload` }, "#8a5a00");
      notified = await pushLine(admin, c.line_user_id, [msg], { client_id: d.client_id, recipient: "client", kind: `doc_${b.status}` });
    }
  }
  return json(req, { ok: true, notified });
});
