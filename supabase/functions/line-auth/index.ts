// รับ LINE ID token จาก LIFF → ตรวจกับ LINE → สร้าง/หา user ใน Supabase → คืน session
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
// Channel ID ไม่ใช่ความลับ ตั้งทับด้วย secret ได้
const LINE_CHANNEL_ID = Deno.env.get("LINE_LOGIN_CHANNEL_ID") ?? "2012074785";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  let idToken: string | undefined;
  try { ({ idToken } = await req.json()); } catch { /* ignore */ }
  if (!idToken) return json(req, { error: "missing_id_token" }, 400);

  // 1) ตรวจ ID token กับ LINE โดยตรง
  const vr = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: LINE_CHANNEL_ID }),
  });
  if (!vr.ok) return json(req, { error: "invalid_line_token" }, 401);
  const line = await vr.json() as { sub: string; name?: string; picture?: string };
  if (!line.sub) return json(req, { error: "invalid_line_token" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const email = `line_${line.sub.toLowerCase()}@line.users.local`;

  // 2) สร้าง user ถ้ายังไม่มี (ไม่มีรหัสผ่าน ล็อกอินได้ผ่าน LINE เท่านั้น)
  const { error: cErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { provider: "line", line_user_id: line.sub },
    user_metadata: { display_name: line.name ?? null },
  });
  if (cErr && !/already|registered|exists/i.test(cErr.message)) {
    console.error("createUser", cErr.message);
    return json(req, { error: "auth_failed" }, 500);
  }

  // 3) ออก session ผ่าน magic link token (ไม่ส่งอีเมลจริง)
  const { data: link, error: lErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (lErr || !link?.properties?.hashed_token) {
    console.error("generateLink", lErr?.message);
    return json(req, { error: "auth_failed" }, 500);
  }
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data: sess, error: vErr } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  if (vErr || !sess.session) {
    console.error("verifyOtp", vErr?.message);
    return json(req, { error: "auth_failed" }, 500);
  }

  // 4) เช็กว่าลงทะเบียนแล้วหรือยัง
  const { data: client } = await admin.from("clients")
    .select("id, status").eq("auth_user_id", sess.user!.id).maybeSingle();

  return json(req, {
    access_token: sess.session.access_token,
    refresh_token: sess.session.refresh_token,
    expires_at: sess.session.expires_at,
    registered: !!client,
    client_status: client?.status ?? null,
    display_name: line.name ?? null,
  });
});
