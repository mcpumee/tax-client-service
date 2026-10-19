// ลูกค้าแก้ประเภท/ปีภาษีของเอกสารที่ยังรอตรวจ (เช่น ตามคำแนะนำของ AI)
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { DOC_CATEGORY } from "../_shared/doctypes.ts";

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
  let b: { document_id?: string; doc_type?: string; tax_year?: number };
  try { b = await req.json(); } catch { return json(req, { error: "bad_json" }, 400); }
  if (!b.document_id || (!b.doc_type && !b.tax_year)) return json(req, { error: "validation" }, 422);
  if (b.doc_type && !DOC_CATEGORY[b.doc_type]) return json(req, { error: "bad_type" }, 422);
  const y = new Date().getFullYear();
  if (b.tax_year && !(b.tax_year >= y - 5 && b.tax_year <= y)) return json(req, { error: "bad_year" }, 422);

  // ต้องเป็นเอกสารของตัวเอง (RLS) และยังรอตรวจ
  const { data: d } = await userClient.from("documents").select("id, status, uploaded_by").eq("id", b.document_id).maybeSingle();
  if (!d || d.status !== "pending_review") return json(req, { error: "not_allowed" }, 403);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const patch: Record<string, unknown> = {};
  if (b.doc_type) { patch.doc_type = b.doc_type; patch.category = DOC_CATEGORY[b.doc_type]; }
  if (b.tax_year) patch.tax_year = b.tax_year;
  // ล้างคำเตือนที่แก้แล้ว
  const { data: cur } = await admin.from("documents").select("ai_issues").eq("id", d.id).single();
  const left = ((cur?.ai_issues as any[]) ?? []).filter((i) =>
    !(b.doc_type && (i.code === "type_mismatch" || i.code === "not_tax_doc")) && !(b.tax_year && i.code === "year_mismatch"));
  patch.ai_issues = left.length ? left : null;
  const { error } = await admin.from("documents").update(patch).eq("id", d.id);
  if (error) return json(req, { error: "update_failed" }, 500);
  return json(req, { ok: true });
});
