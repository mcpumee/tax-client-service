// ส่งข้อความ LINE Messaging API (push) + บันทึกผลลงตาราง notifications
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

const TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
export const LIFF_URL = "https://liff.line.me/2012074785-0ZDimQpy";
export const ADMIN_URL = "https://mc-service-tax.netlify.app/admin";

export async function pushLine(
  admin: SupabaseClient,
  to: string,
  messages: unknown[],
  log: { client_id?: string | null; recipient: "client" | "admin"; kind: string },
): Promise<boolean> {
  let ok = false, error: string | null = null;
  if (!TOKEN) {
    error = "LINE_CHANNEL_ACCESS_TOKEN not set";
  } else {
    try {
      const r = await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ to, messages }),
      });
      ok = r.ok;
      if (!r.ok) error = `${r.status} ${(await r.text()).slice(0, 200)}`;
    } catch (e) {
      error = String(e).slice(0, 200);
    }
  }
  if (error) console.error("pushLine", log.kind, error);
  await admin.from("notifications").insert({ client_id: log.client_id ?? null, recipient: log.recipient, kind: log.kind, ok, error });
  return ok;
}

// ปุ่มลิงก์แบบ Flex เรียบ ๆ
export function card(title: string, lines: string[], button?: { label: string; uri: string }, color = "#26324a") {
  return {
    type: "flex",
    altText: title,
    contents: {
      type: "bubble",
      header: { type: "box", layout: "vertical", backgroundColor: color, paddingAll: "16px",
        contents: [{ type: "text", text: title, color: "#ffffff", weight: "bold", size: "md", wrap: true }] },
      body: { type: "box", layout: "vertical", spacing: "sm", paddingAll: "16px",
        contents: lines.map((t) => ({ type: "text", text: t, size: "sm", color: "#333333", wrap: true })) },
      ...(button ? { footer: { type: "box", layout: "vertical", paddingAll: "12px",
        contents: [{ type: "button", style: "primary", color, height: "sm",
          action: { type: "uri", label: button.label, uri: button.uri } }] } } : {}),
    },
  };
}
