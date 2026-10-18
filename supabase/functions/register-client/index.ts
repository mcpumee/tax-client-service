// ลงทะเบียนลูกค้าใหม่ (ต้องล็อกอินผ่าน line-auth ก่อน)
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { ADMIN_URL, card, pushLine } from "../_shared/line.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const CONSENT_VERSION = "2026-10-v1";

function validNid(nid: string): boolean {
  if (!/^\d{13}$/.test(nid)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(nid[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(nid[12]);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json(req, { error: "unauthorized" }, 401);
  const lineUserId = user.app_metadata?.line_user_id as string | undefined;
  if (!lineUserId) return json(req, { error: "line_login_required" }, 403);

  let b: Record<string, any>;
  try { b = await req.json(); } catch { return json(req, { error: "bad_json" }, 400); }

  const nid = String(b.national_id ?? "").replace(/\D/g, "");
  const errors: string[] = [];
  if (!b.first_name?.trim()) errors.push("first_name");
  if (!b.last_name?.trim()) errors.push("last_name");
  if (!validNid(nid)) errors.push("national_id");
  if (!/^0\d{8,9}$/.test(String(b.phone ?? "").replace(/\D/g, ""))) errors.push("phone");
  if (!["single", "married", "divorced", "widowed"].includes(b.marital_status)) errors.push("marital_status");
  if (b.consents?.tax_service !== true) errors.push("consent_tax_service");
  if (b.consents?.cross_border_storage !== true) errors.push("consent_cross_border_storage");
  if (errors.length) return json(req, { error: "validation", fields: errors }, 422);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: existing } = await admin.from("clients").select("id").eq("auth_user_id", user.id).maybeSingle();
  if (existing) return json(req, { error: "already_registered" }, 409);

  const { data: client, error: iErr } = await admin.from("clients").insert({
    auth_user_id: user.id,
    line_user_id: lineUserId,
    title: b.title?.trim() || null,
    first_name: b.first_name.trim(),
    last_name: b.last_name.trim(),
    birth_date: b.birth_date || null,
    phone: String(b.phone).replace(/\D/g, ""),
    email: b.email?.trim() || null,
    address: b.address?.trim() || null,
    marital_status: b.marital_status,
    status: "pending",
  }).select("id").single();
  if (iErr) {
    console.error("insert client", iErr.message);
    return json(req, { error: "register_failed" }, 500);
  }

  // เข้ารหัสเลข ปชช. ผ่าน RPC ในสิทธิ์ของลูกค้าเอง
  const { error: nErr } = await userClient.rpc("set_national_id", { p_client: client.id, p_nid: nid });
  if (nErr) {
    await admin.from("clients").delete().eq("id", client.id);
    const dup = /duplicate|unique/i.test(nErr.message);
    return json(req, { error: dup ? "national_id_already_registered" : "register_failed" }, dup ? 409 : 500);
  }

  const c = b.consents ?? {};
  await admin.from("consents").insert([
    { client_id: client.id, consent_type: "tax_service", version: CONSENT_VERSION, granted: true, channel: "liff" },
    { client_id: client.id, consent_type: "cross_border_storage", version: CONSENT_VERSION, granted: true, channel: "liff" },
    { client_id: client.id, consent_type: "marketing_insurance", version: CONSENT_VERSION, granted: c.marketing_insurance === true, channel: "liff" },
  ]);

  // แจ้ง admin ทาง LINE (ไม่รอผล ไม่ให้กระทบการลงทะเบียน)
  const notifyAdmins = (async () => {
    const { data: admins } = await admin.from("admins").select("line_user_id")
      .eq("notify_new_client", true).not("line_user_id", "is", null);
    for (const a of admins ?? []) {
      await pushLine(admin, a.line_user_id!, [card("ลูกค้าใหม่รออนุมัติ", [
        `${b.title ?? ""}${b.first_name.trim()} ${b.last_name.trim()}`,
        `สมัครเมื่อ ${new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}`,
      ], { label: "เปิดหลังบ้าน", uri: ADMIN_URL })], { client_id: client.id, recipient: "admin", kind: "new_client" });
    }
  })();
  // @ts-ignore EdgeRuntime มีใน Supabase Edge Functions
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(notifyAdmins); else await notifyAdmins;

  return json(req, { ok: true, client_id: client.id, status: "pending" });
});
