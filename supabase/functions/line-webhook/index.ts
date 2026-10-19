// LINE OA webhook — แชทบอทเบื้องต้น
// • ตอบคำถามการใช้งานแอป + ความรู้ภาษีเบื้องต้นแบบสั้น (กฎ + Gemini ถ้ามี key)
// • คำถามภาษี / ขอคุยเจ้าหน้าที่ → ส่งต่อเจ้าหน้าที่ แจ้ง admin ทาง LINE และ "พักบอท" ให้คนคุยเอง
// ความปลอดภัย: ตรวจลายเซ็น LINE ทุกครั้ง, ปิดตัวเลขยาว ๆ (เลข ปชช./บัญชี/โทร) ก่อนส่ง AI และก่อนบันทึก
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { ADMIN_URL, LIFF_URL, pushLine } from "../_shared/line.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("LINE_CHANNEL_SECRET");
const TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY");
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";
const PAUSE_HOURS = 4;           // บอทเงียบหลัง admin กด "ฉันจะตอบเอง"
const PING_GAP_MIN = 15;         // แจ้ง admin ซ้ำได้ไม่ถี่กว่านี้ต่อผู้ใช้

// ---------- ปุ่มลัด ----------
const QR = {
  health: { type: "action", action: { type: "uri", label: "สุขภาพภาษี", uri: `${LIFF_URL}?p=health` } },
  upload: { type: "action", action: { type: "uri", label: "นำส่งเอกสาร", uri: `${LIFF_URL}?p=upload` } },
  docs:   { type: "action", action: { type: "uri", label: "เอกสารของฉัน", uri: `${LIFF_URL}?p=docs` } },
  me:     { type: "action", action: { type: "uri", label: "ข้อมูลของฉัน", uri: `${LIFF_URL}?p=me` } },
  reg:    { type: "action", action: { type: "uri", label: "ลงทะเบียน", uri: LIFF_URL } },
  staff:  { type: "action", action: { type: "message", label: "ปรึกษาเจ้าหน้าที่", text: "ปรึกษาเจ้าหน้าที่" } },
};
type QRKey = keyof typeof QR;

// ---------- คำถามที่พบบ่อย (ใช้เมื่อไม่มี AI หรือ AI ล้มเหลว) ----------
type Faq = { re: RegExp; a: string | ((s: Status) => string); btn: QRKey[] };
type Status = "none" | "pending" | "active" | "inactive";
const FAQ: Faq[] = [
  { re: /ลงทะเบียน|สมัคร|เริ่มใช้|ใช้ยังไง|ใช้งานยังไง/,
    a: (s) => s === "none"
      ? "เริ่มใช้งานได้ง่าย ๆ ครับ กดปุ่ม \"ลงทะเบียน\" ด้านล่าง → อ่านและยินยอมการใช้ข้อมูล → กรอกข้อมูล → รอเจ้าหน้าที่อนุมัติ ระบบจะแจ้งผลทางแชทนี้ครับ"
      : s === "pending" ? "คุณลงทะเบียนแล้วครับ ตอนนี้กำลังรอเจ้าหน้าที่อนุมัติ เมื่ออนุมัติแล้วจะแจ้งทางแชทนี้ และจะส่งเอกสารได้ทันทีครับ"
      : "คุณลงทะเบียนเรียบร้อยแล้วครับ ใช้เมนูด้านล่างได้เลย: สุขภาพภาษี · นำส่งเอกสาร · เอกสารของฉัน · ข้อมูลของฉัน",
    btn: ["reg", "health", "upload"] },
  { re: /อนุมัติ|รอนาน|สถานะ.*(บัญชี|สมัคร)/,
    a: (s) => s === "pending" ? "บัญชีของคุณกำลังรอเจ้าหน้าที่อนุมัติครับ ปกติไม่นาน เมื่ออนุมัติแล้วจะมีข้อความแจ้งในแชทนี้ครับ"
      : s === "active" ? "บัญชีของคุณอนุมัติแล้วครับ ใช้งานได้ทุกเมนู" : "ดูสถานะบัญชีได้ที่เมนู \"ข้อมูลของฉัน\" ครับ",
    btn: ["me"] },
  { re: /(ส่ง|อัพ|อัป|อัพโหลด|อัปโหลด|แนบ|ถ่าย).*(เอกสาร|ไฟล์|รูป|ทวิ|ใบ)|(เอกสาร|ไฟล์|รูป).*(ส่ง|อัพ|อัป|แนบ).*(ยังไง|ไม่ได้|ที่ไหน)/,
    a: (s) => (s === "pending" ? "หมายเหตุ: ส่งเอกสารได้หลังเจ้าหน้าที่อนุมัติบัญชีนะครับ\n\n" : "") +
      "วิธีส่งเอกสาร: เมนู \"นำส่งเอกสาร\" → เลือกประเภทและปีภาษี → ถ่ายรูปหรือเลือกไฟล์ (รูปหรือ PDF ไม่เกิน 20 MB) → กดส่ง\nระบบจะช่วยตรวจทันทีว่าเลือกประเภทถูกไหม รูปชัดไหม ถ้ามีปัญหาจะมีปุ่มให้แก้ได้เลยครับ",
    btn: ["upload", "docs"] },
  { re: /ไฟล์.*(ใหญ่|ไม่ได้|ไม่ขึ้น)|heic|pdf|นามสกุล|ขนาด/i,
    a: "รองรับไฟล์รูป (JPG, PNG, HEIC, WEBP) และ PDF ขนาดไม่เกิน 20 MB ครับ ถ้าไฟล์ใหญ่เกิน ลองถ่ายใหม่ให้เห็นเอกสารเต็มใบ หรือส่งทีละหน้าครับ",
    btn: ["upload"] },
  { re: /ประเภท.*ผิด|เลือกผิด|ผิดประเภท|ปีผิด/,
    a: "ถ้าระบบเตือนว่าประเภทหรือปีไม่ตรง กดปุ่ม \"เปลี่ยนเป็น…\" ที่ขึ้นมาได้เลยครับ ถ้าส่งไปแล้วและยังรอตรวจ เจ้าหน้าที่จะช่วยแก้ให้ตอนตรวจครับ",
    btn: ["docs"] },
  { re: /ลบ.*(เอกสาร|ไฟล์|รูป)|ส่งผิด.*(ลบ|ยกเลิก)/,
    a: "เพื่อความปลอดภัยของข้อมูล ลูกค้าลบเอกสารเองไม่ได้ครับ ถ้าส่งผิดไม่ต้องกังวล แจ้งเจ้าหน้าที่ได้เลย หรือส่งใบที่ถูกต้องเพิ่มเข้าไป เจ้าหน้าที่จะจัดการให้ตอนตรวจครับ",
    btn: ["staff", "docs"] },
  { re: /รอตรวจ|ส่งใหม่|ไม่ผ่าน|ผ่านแล้ว|สถานะ.*เอกสาร|เอกสาร.*สถานะ/,
    a: "สถานะเอกสาร:\n⏳ รอตรวจ — เจ้าหน้าที่ยังไม่ได้ตรวจ\n✅ ผ่าน — ตัวเลขถูกนำไปคำนวณในสุขภาพภาษีแล้ว\n↩️ ขอส่งใหม่ — ดูเหตุผลในเมนู \"เอกสารของฉัน\" แล้วส่งใบใหม่ได้เลยครับ",
    btn: ["docs"] },
  { re: /(ตัวเลข|ยอด|คะแนน|สุขภาพ).*(ไม่อัพ|ไม่อัป|ไม่เปลี่ยน|ไม่ขึ้น|ไม่ตรง|ผิด)|ทำไม.*(ไม่ขึ้น|ไม่อัพ|ไม่อัป)/,
    a: "ตัวเลขจากเอกสารจะเข้าไปในสุขภาพภาษีหลังเจ้าหน้าที่ตรวจและกด \"ผ่าน\" แล้วครับ ระหว่างรอ คุณกรอกตัวเลขเองได้ในหน้าสุขภาพภาษี (ปุ่มคำนวณ/แก้ข้อมูล) ครับ",
    btn: ["health", "docs"] },
  { re: /เปิดไม่ได้|เข้าไม่ได้|หน้าขาว|ค้าง|โหลดไม่|error|400|ไม่ขึ้น|เด้ง/i,
    a: "ลองแก้ตามนี้ครับ:\n1) เปิดจากเมนูในแชท LINE นี้ (ไม่เปิดผ่านเบราว์เซอร์)\n2) อัปเดตแอป LINE เป็นเวอร์ชันล่าสุด\n3) ปิดหน้าแล้วเปิดใหม่ หรือปิด-เปิดแอป LINE\n4) ตรวจอินเทอร์เน็ต\nถ้ายังไม่ได้ กดปรึกษาเจ้าหน้าที่ แล้วแคปหน้าจอส่งมาได้เลยครับ",
    btn: ["health", "staff"] },
  { re: /สุขภาพภาษี|คะแนน|คืออะไร.*สุขภาพ/,
    a: "\"สุขภาพภาษี\" คือภาพรวมภาษีปีนี้ของคุณ: ประมาณภาษีที่ต้องจ่าย เทียบกับที่ถูกหักไว้ ใช้สิทธิลดหย่อนไปเท่าไร และมีเอกสารครบไหม คะแนนยิ่งสูงยิ่งดีครับ ส่วนคำแนะนำเฉพาะตัว เจ้าหน้าที่ช่วยดูให้ได้ครับ",
    btn: ["health", "staff"] },
  { re: /แก้.*(ข้อมูล|ชื่อ|เบอร์|ที่อยู่|อีเมล)|เปลี่ยน.*(ชื่อ|เบอร์|ที่อยู่|อีเมล)|ข้อมูล.*ผิด/,
    a: "ดูข้อมูลของคุณได้ที่เมนู \"ข้อมูลของฉัน\" ครับ ถ้าต้องการแก้ไข (ชื่อ เบอร์ ที่อยู่ ฯลฯ) แจ้งเจ้าหน้าที่ เพื่อยืนยันตัวตนก่อนแก้ให้ครับ",
    btn: ["me", "staff"] },
  { re: /ปลอดภัย|ข้อมูลรั่ว|ใครเห็น|เก็บข้อมูล|pdpa|ความเป็นส่วนตัว/i,
    a: "ข้อมูลของคุณเก็บในระบบที่เข้ารหัส เลขบัตรประชาชนเข้ารหัสแยกอีกชั้น เอกสารเปิดได้เฉพาะคุณและเจ้าหน้าที่ที่ยืนยันตัวตน 2 ขั้นเท่านั้น และทุกการเปิดดูมีบันทึกไว้ครับ",
    btn: ["me"] },
];
// ---------- ความรู้ภาษีเบื้องต้น (ตอบสั้น ๆ ไม่ลงรายละเอียดรายบุคคล) ----------
const TAX_TAIL = "\n\nอยากรู้ว่าตัวเองควรทำอะไร ลองดูที่ \"สุขภาพภาษี\" หรือกดปรึกษาเจ้าหน้าที่ได้ครับ";
const TAX_FAQ: { re: RegExp; a: string }[] = [
  { re: /50\s?ทวิ/,
    a: "50 ทวิ คือหนังสือรับรองการหักภาษี ณ ที่จ่าย ที่นายจ้าง/ผู้จ่ายเงินออกให้ บอกว่าทั้งปีจ่ายเงินให้เราเท่าไร และหักภาษีไว้เท่าไร ใช้ประกอบการยื่นภาษีครับ" },
  { re: /ภ\.?\s?ง\.?\s?ด\.?\s?(90|91)/,
    a: "ภ.ง.ด.91 ใช้ยื่นเมื่อมีเงินเดือน/ค่าจ้างอย่างเดียว\nภ.ง.ด.90 ใช้เมื่อมีเงินได้ประเภทอื่นด้วย เช่น ค่าจ้างฟรีแลนซ์ ค่าเช่า ขายของ\nเจ้าหน้าที่จะเลือกแบบที่ถูกต้องให้ตอนยื่นครับ" },
  { re: /ภาษีเงินได้.*คือ|คือ.*ภาษีเงินได้|ภาษีบุคคลธรรมดา.*คือ/,
    a: "ภาษีเงินได้บุคคลธรรมดา คือภาษีที่เก็บจากรายได้ของเราในแต่ละปี (ม.ค.–ธ.ค.) เช่น เงินเดือน ค่าจ้าง ค่าเช่า รายได้จากธุรกิจ\nคิดจาก: เงินได้ − ค่าใช้จ่าย − ค่าลดหย่อน = เงินได้สุทธิ แล้วคูณอัตราขั้นบันได 0–35% และยื่นปีละครั้งช่วงต้นปีถัดไปครับ" },
  { re: /ลดหย่อน.*(อะไรบ้าง|มีอะไร|ประเภท|รายการ|ได้บ้าง|ล่าสุด|ปีนี้)|(อะไรบ้าง|มีอะไร).*ลดหย่อน/,
    a: "ค่าลดหย่อนหลัก ๆ ปีภาษี 2569:\n• ส่วนตัว / คู่สมรส / บุตร / อุปการะพ่อแม่\n• ประกันสังคม\n• ประกันชีวิต ประกันสุขภาพ (ตัวเองและพ่อแม่) ประกันบำนาญ\n• กองทุน PVD, RMF, Thai ESGX, กอช.\n• ดอกเบี้ยบ้าน, บริจาค, Solar rooftop\nแต่ละรายการมีเพดานต่างกันครับ" },
  { re: /ยื่น.*(เมื่อไหร่|เมื่อไร|วันไหน|กำหนด|ภายใน|ช่วงไหน|หมดเขต|ทัน)|(หมดเขต|กำหนด).*ยื่น/,
    a: "ยื่นภาษีเงินได้ของปีที่แล้วช่วง 1 ม.ค. – 31 มี.ค. ของทุกปี ถ้ายื่นออนไลน์ กรมสรรพากรมักขยายเวลาให้ถึงต้นเดือนเมษายนครับ (ดูประกาศแต่ละปี)\nลูกค้า TA ไม่ต้องกังวล เจ้าหน้าที่ยื่นแทนให้ครับ" },
  { re: /อัตรา|ขั้นบันได|กี่เปอร์เซ็น|กี่%/,
    a: "อัตราภาษีแบบขั้นบันได (คิดจากเงินได้สุทธิ):\n0–150,000 ยกเว้น\n150,001–300,000 = 5%\n300,001–500,000 = 10%\n500,001–750,000 = 15%\n750,001–1 ล้าน = 20%\n1–2 ล้าน = 25% · 2–5 ล้าน = 30% · เกิน 5 ล้าน = 35%" },
  { re: /(เท่าไหร่|เท่าไร).*(ต้องยื่น|ถึงยื่น)|ต้องยื่น.*(ไหม|มั้ย|หรือเปล่า)/,
    a: "เกณฑ์คร่าว ๆ ที่ต้องยื่นแบบ (แม้ไม่ต้องเสียภาษี):\n• โสด มีเงินเดือนอย่างเดียว เกิน 120,000 บาท/ปี\n• โสด มีเงินได้ประเภทอื่น เกิน 60,000 บาท/ปี\n• สมรส: เงินเดือน เกิน 220,000 / ประเภทอื่น เกิน 120,000 บาท/ปี" },
  { re: /ประกันสังคม.*(ลดหย่อน|หัก)|ลดหย่อน.*ประกันสังคม/,
    a: "เงินสมทบประกันสังคมที่จ่ายจริงทั้งปี นำมาลดหย่อนได้ทั้งหมด ปีภาษี 2569 สูงสุด 10,500 บาท (ปี 2568 สูงสุด 9,000 บาท) ครับ" },
  { re: /(ประกัน|กองทุน|rmf|esg|pvd).*(ลดหย่อน|ลด)ได้.*(เท่าไหร่|เท่าไร|กี่บาท)/i,
    a: "เพดานโดยสรุป (ปีภาษี 2569):\n• ประกันชีวิต 100,000 · ประกันสุขภาพตัวเอง 25,000 (รวมกันไม่เกิน 100,000)\n• ประกันสุขภาพพ่อแม่ 15,000\n• ประกันบำนาญ 15% ไม่เกิน 200,000\n• RMF 30% ไม่เกิน 500,000 · Thai ESGX 30% ไม่เกิน 300,000\n• กลุ่มเกษียณ (บำนาญ+PVD+RMF+กอช.) รวมไม่เกิน 500,000" },
  { re: /easy\s?e.?receipt|ช้อปดีมีคืน/i,
    a: "Easy E-Receipt ของปีภาษี 2569 ยังไม่มีประกาศจากรัฐครับ ถ้าประกาศเมื่อไร เจ้าหน้าที่จะแจ้งให้ทราบครับ" },
  { re: /เงินคืน.*(นาน|กี่วัน|เมื่อไหร่|เมื่อไร)|(ขอคืน|คืนภาษี).*(ยังไง|นาน|เมื่อไหร่)/,
    a: "ถ้าถูกหักภาษีไว้มากกว่าที่ต้องเสียจริง จะได้เงินคืน ยื่นออนไลน์และเอกสารครบ ปกติได้คืนภายในไม่กี่สัปดาห์ถึงประมาณ 1–3 เดือน เข้าบัญชีพร้อมเพย์ที่ผูกเลขบัตรประชาชนครับ" },
];
// คำถามเฉพาะตัว → ให้เจ้าหน้าที่ตอบ
const RE_PERSONAL = /ฉัน|ผม|หนู|ของเรา|ตัวเอง|เงินเดือน\s?\d|\d{4,}|ช่วยคำนวณ|คำนวณให้|ควรซื้อ|อยากซื้อ|อยากมี|อยากได้|ซื้ออะไร|ทำยังไงดี|แนะนำ.*(ประกัน|กองทุน|แผน)|ปีนี้ต้องเสีย|ต้องเสีย.*เท่า|ได้คืน.*เท่า/;

const RE_STAFF = /ปรึกษาเจ้าหน้าที่|คุยกับ(เจ้าหน้าที่|คน|แอดมิน)|ติดต่อ(เจ้าหน้าที่|แอดมิน)|ขอคุย|แอดมิน|^admin$|เจ้าหน้าที่/i;
const RE_TAX = /ภาษี|ลดหย่อน|ภ\.?\s?ง\.?\s?ด|สรรพากร|คืนเงิน|เงินคืน|ยื่น|หัก\s?ณ|rmf|ssf|esg|กองทุน|ประกัน.*(ลด|หัก)|เบี้ย|ดอกเบี้ยบ้าน|บริจาค|เงินได้|ค่าบริการ|ราคา|ค่าธรรมเนียม/i;
const RE_ASK = /เท่าไหร่|เท่าไร|ได้ไหม|ได้มั้ย|ได้หรือ|คุ้ม|ควร|ต้อง|แนะนำ|ดีไหม|ดีมั้ย|ยังไงดี/;
const RE_GREET = /^(สวัสดี|หวัดดี|ดีครับ|ดีค่ะ|hello|hi|ทัก)/i;
const RE_THANKS = /^(ขอบคุณ|ขอบใจ|thank|โอเค|ok|ได้ครับ|ได้ค่ะ|รับทราบ)/i;
const RE_RESUME = /^(บอท|เมนู|ช่วยเหลือ|help|menu)$/i;

// ---------- utils ----------
const mask = (t: string) => t.replace(/\d[\d\s-]{7,}\d/g, "[ตัวเลข]").slice(0, 500);

async function verify(body: string, sig: string | null): Promise<boolean> {
  if (!SECRET || !sig) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const expect = btoa(String.fromCharCode(...mac));
  if (expect.length !== sig.length) return false;
  let d = 0;
  for (let i = 0; i < expect.length; i++) d |= expect.charCodeAt(i) ^ sig.charCodeAt(i);
  return d === 0;
}

async function reply(token: string, text: string, btn: QRKey[] = []) {
  const msg: Record<string, unknown> = { type: "text", text: text.slice(0, 4900) };
  if (btn.length) msg.quickReply = { items: btn.map((k) => QR[k]) };
  const r = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ replyToken: token, messages: [msg] }),
  });
  if (!r.ok) console.error("reply", r.status, (await r.text()).slice(0, 200));
}

// จุดไข่ปลา "กำลังพิมพ์…" ของ LINE (แชท 1:1) — หายเองเมื่อข้อความตอบกลับถึง
const MIN_THINK_MS = 1500;
async function startLoading(uid: string) {
  try {
    await fetch("https://api.line.me/v2/bot/chat/loading/start", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ chatId: uid, loadingSeconds: 20 }),
    });
  } catch { /* ไม่สำคัญ */ }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function displayName(uid: string): Promise<string> {
  try {
    const r = await fetch(`https://api.line.me/v2/bot/profile/${uid}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (r.ok) return (await r.json()).displayName ?? "";
  } catch { /* ignore */ }
  return "";
}

// ---------- AI (Gemini) ----------
const KB = `คุณคือผู้ช่วยแชทของบริการ "Tax Assistance (TA)" — บริการยื่นภาษีเงินได้บุคคลธรรมดาผ่าน LINE OA
หน้าที่: (ก) ช่วยแก้ปัญหาการใช้งานแอป (ข) ตอบความรู้ภาษีเบื้องต้นแบบสั้น ๆ (ค) ส่งคำถามเฉพาะตัวให้เจ้าหน้าที่
ความรู้เรื่องแอป:
- เมนูใน LINE: สุขภาพภาษี (ภาพรวมภาษีปีนี้ คะแนน ภาษีที่คาดว่าต้องจ่ายเทียบกับที่ถูกหัก สิทธิลดหย่อนที่ใช้ไป และกรอกตัวเลขเองเพื่อคำนวณได้), นำส่งเอกสาร, เอกสารของฉัน, ข้อมูลของฉัน, ปรึกษาเจ้าหน้าที่
- ลงทะเบียน: เปิดลิงก์ลงทะเบียน → ยินยอมการใช้ข้อมูล → กรอกข้อมูล → รอเจ้าหน้าที่อนุมัติ → แจ้งผลทางแชท ส่งเอกสารได้หลังอนุมัติเท่านั้น
- ส่งเอกสาร: เมนูนำส่งเอกสาร → เลือกประเภท+ปีภาษี → ถ่ายรูป/เลือกไฟล์ (JPG PNG HEIC WEBP PDF ≤ 20MB) → ส่ง ระบบ AI ตรวจทันทีว่าประเภทถูก รูปชัด ปีตรง ชื่อตรง ถ้าไม่ตรงมีปุ่ม "เปลี่ยนเป็น…"/"ถ่ายใหม่"
- สถานะเอกสาร: รอตรวจ / ผ่าน (ตัวเลขเข้าสุขภาพภาษี) / ขอส่งใหม่ (ดูเหตุผลในเอกสารของฉัน)
- ตัวเลขจากเอกสารเข้าสุขภาพภาษีหลังเจ้าหน้าที่กดผ่านเท่านั้น ระหว่างรอกรอกเองได้
- ลูกค้าลบเอกสารเองไม่ได้ (ความปลอดภัย) ให้แจ้งเจ้าหน้าที่ แก้ข้อมูลส่วนตัวต้องแจ้งเจ้าหน้าที่
- เปิดหน้าไม่ได้: เปิดจากเมนูใน LINE, อัปเดต LINE, ปิดเปิดใหม่, เช็กเน็ต, ยังไม่ได้ให้แคปหน้าจอส่งเจ้าหน้าที่
- ความปลอดภัย: ข้อมูลเข้ารหัส เลขบัตรเข้ารหัสอีกชั้น เปิดดูได้เฉพาะลูกค้าและเจ้าหน้าที่ที่ยืนยันตัวตน 2 ขั้น มีบันทึกการเข้าดู
ความรู้ภาษี (ปีภาษี 2569 ยื่นต้นปี 2570):
- ภาษีเงินได้บุคคลธรรมดา: เก็บจากรายได้ ม.ค.–ธ.ค. คิดจาก เงินได้ − ค่าใช้จ่าย − ลดหย่อน = เงินได้สุทธิ × ขั้นบันได
- ขั้นบันได: 0–150,000 ยกเว้น / ถึง 300,000 5% / ถึง 500,000 10% / ถึง 750,000 15% / ถึง 1 ล้าน 20% / ถึง 2 ล้าน 25% / ถึง 5 ล้าน 30% / เกิน 35%
- ค่าใช้จ่ายเงินเดือน 50% ไม่เกิน 100,000
- ลดหย่อน: ส่วนตัว 60,000 คู่สมรสไม่มีเงินได้ 60,000 บุตร 30,000 (คนที่ 2 ขึ้นไปเกิดตั้งแต่ 2561 = 60,000) พ่อแม่คนละ 30,000 ฝากครรภ์ 60,000 ประกันสังคมตามจ่ายสูงสุด 10,500 (ปี 2568 = 9,000)
- ประกันชีวิต 100,000 ประกันสุขภาพตัวเอง 25,000 (รวมกันไม่เกิน 100,000) สุขภาพพ่อแม่ 15,000 ชีวิตคู่สมรส 10,000 บำนาญ 15% ไม่เกิน 200,000
- PVD/กบข. 15% ไม่เกิน 500,000 RMF 30% ไม่เกิน 500,000 กอช. 30,000 (กลุ่มเกษียณรวมไม่เกิน 500,000) Thai ESGX 30% ไม่เกิน 300,000
- ดอกเบี้ยบ้าน 100,000 Solar rooftop 200,000 บริจาคไม่เกิน 10% (การศึกษา/กีฬา/รพ.รัฐ ลดได้ 2 เท่า)
- Easy E-Receipt ปี 2569 ยังไม่ประกาศ
- กำหนดยื่น 1 ม.ค.–31 มี.ค. ออนไลน์มักขยายถึงต้นเม.ย. / ภ.ง.ด.91 เงินเดือนอย่างเดียว ภ.ง.ด.90 มีเงินได้อื่น / 50 ทวิ = หนังสือรับรองหัก ณ ที่จ่าย
- เกณฑ์ต้องยื่น: โสดเงินเดือน >120,000 อื่น >60,000 สมรสเงินเดือน >220,000 อื่น >120,000
กฎ:
1) คำถามความรู้ภาษีทั่วไป (คืออะไร มีอะไรบ้าง ยื่นเมื่อไร อัตรา เพดานลดหย่อน) → intent "taxinfo" ตอบสั้น 2–6 บรรทัด ใช้เฉพาะข้อมูลข้างบน ไม่ลงรายละเอียดเงื่อนไขปลีกย่อย ไม่คำนวณให้รายบุคคล ลงท้ายว่าอยากได้คำแนะนำเฉพาะตัวให้กดปรึกษาเจ้าหน้าที่ ถ้าข้อมูลข้างบนไม่พอตอบ → "tax"
1.1) คำถามเฉพาะตัว (ต้องเสีย/ได้คืนเท่าไร คำนวณให้ ควรซื้ออะไร อยากซื้อประกัน/กองทุน กรณีของฉัน) ค่าบริการ หรือขอคำแนะนำการเงิน → intent "tax" (ห้ามตอบเนื้อหา)
2) ขอคุยกับคน/เจ้าหน้าที่ หรือปัญหาที่ต้องให้เจ้าหน้าที่แก้ (แก้ข้อมูล ลบเอกสาร บัญชีมีปัญหา) และแก้เองไม่ได้ → "staff"
3) คำถามการใช้งานแอปที่ตอบได้จากความรู้ข้างบน → "app" ตอบสั้น ชัด เป็นขั้นตอน ลงท้าย "ครับ" ไม่เกิน 6 บรรทัด ห้ามแต่งข้อมูลที่ไม่มีข้างบน
4) ทักทาย/ขอบคุณ → "greeting" ตอบสั้น ๆ
5) ไม่แน่ใจ/นอกเรื่อง → "other"
buttons: เลือกได้ 0-3 จาก ["health","upload","docs","me","reg","staff"] ที่ช่วยผู้ใช้ทำต่อ
ตอบเป็น JSON เท่านั้น: {"intent":"app|taxinfo|tax|staff|greeting|other","reply":"...","buttons":[...]}`;

const STATUS_TH: Record<Status, string> = { none: "ยังไม่ลงทะเบียน", pending: "ลงทะเบียนแล้ว รออนุมัติ", active: "อนุมัติแล้ว ใช้งานได้", inactive: "บัญชีถูกระงับ" };

async function askAI(text: string, s: Status): Promise<{ intent: string; reply: string; buttons: QRKey[] } | null> {
  if (!GEMINI_KEY) return null;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 9000);
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: "POST", signal: ctl.signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: KB }] },
        contents: [{ role: "user", parts: [{ text: `สถานะผู้ใช้: ${STATUS_TH[s]}\nข้อความ: ${text}` }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0, maxOutputTokens: 600, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
    clearTimeout(t);
    if (!r.ok) { console.error("gemini", r.status, (await r.text()).slice(0, 200)); return null; }
    const j = await r.json();
    const o = JSON.parse(j.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}");
    const intent = ["app", "taxinfo", "tax", "staff", "greeting", "other"].includes(o.intent) ? o.intent : "other";
    const buttons = (Array.isArray(o.buttons) ? o.buttons : []).filter((b: string) => b in QR).slice(0, 3) as QRKey[];
    return { intent, reply: String(o.reply ?? "").slice(0, 1500), buttons };
  } catch (e) {
    console.error("gemini", String(e).slice(0, 200));
    return null;
  }
}

function byRules(text: string, s: Status): { intent: string; reply: string; buttons: QRKey[] } {
  const faq = FAQ.find((f) => f.re.test(text));
  const taxy = RE_TAX.test(text) || /ทวิ|ประกัน|กองทุน/.test(text);
  if (taxy && RE_PERSONAL.test(text)) return { intent: "tax", reply: "", buttons: [] };
  const tf = TAX_FAQ.find((f) => f.re.test(text));
  if (tf && !(faq && /(ส่ง|อัพ|อัป|แนบ)/.test(text))) return { intent: "taxinfo", reply: tf.a + TAX_TAIL, buttons: ["health", "staff"] };
  // คำถามภาษีจริง (มีคำถามเชิงตัวเลข/คำแนะนำ) ชนะ FAQ, ไม่งั้น FAQ การใช้งานมาก่อน
  if (taxy && (RE_ASK.test(text) || !faq)) return { intent: "tax", reply: "", buttons: [] };
  if (faq) return { intent: "app", reply: typeof faq.a === "function" ? faq.a(s) : faq.a, buttons: faq.btn };
  if (RE_GREET.test(text)) return { intent: "greeting", reply: "", buttons: [] };
  if (RE_THANKS.test(text)) return { intent: "greeting", reply: "ยินดีครับ 😊 มีอะไรให้ช่วยพิมพ์มาได้เลยครับ", buttons: [] };
  return { intent: "other", reply: "", buttons: [] };
}

// ---------- ส่งต่อเจ้าหน้าที่ ----------
async function handoff(db: SupabaseClient, ev: { replyToken: string }, uid: string, client: ClientRow | null,
  thread: ThreadRow | null, kind: "tax" | "staff", text: string) {
  const now = new Date();
  const { data: sr } = await db.from("support_requests")
    .insert({ line_user_id: uid, client_id: client?.id ?? null, kind, message: mask(text) }).select("id").single();
  const ping = !thread?.last_admin_ping || now.getTime() - new Date(thread.last_admin_ping).getTime() > PING_GAP_MIN * 60000;
  await db.from("chat_threads").upsert({
    line_user_id: uid, client_id: client?.id ?? null,
    last_admin_ping: ping ? now.toISOString() : thread?.last_admin_ping ?? null,
    updated_at: now.toISOString(),
  });

  const msg = kind === "tax"
    ? "คำถามเรื่องภาษีขอให้เจ้าหน้าที่เป็นคนตอบนะครับ เพราะต้องดูจากข้อมูลจริงของคุณจึงจะแนะนำได้ถูกต้อง 🙏\nส่งเรื่องให้เจ้าหน้าที่แล้ว จะตอบกลับในแชทนี้ครับ\nระหว่างนี้ถามเรื่องการใช้งานแอปกับผู้ช่วยได้ตามปกติครับ" +
      (client?.status === "active" ? "\n\nระหว่างรอ ดูภาพรวมภาษีของคุณได้ที่ \"สุขภาพภาษี\" ครับ" : "")
    : "ส่งเรื่องให้เจ้าหน้าที่แล้วครับ 🙏 จะตอบกลับในแชทนี้โดยเร็ว พิมพ์รายละเอียดเพิ่มเติมไว้ได้เลย\nระหว่างนี้ถามเรื่องการใช้งานแอปกับผู้ช่วยได้ตามปกติครับ";
  await reply(ev.replyToken, msg, kind === "tax" && client?.status === "active" ? ["health"] : []);

  if (!ping) return;
  const who = client ? `${client.client_code ?? ""} ${client.first_name} ${client.last_name}`.trim()
    : `${(await displayName(uid)) || "ผู้ใช้ LINE"} (ยังไม่ลงทะเบียน)`;
  const { data: admins } = await db.from("admins").select("line_user_id").not("line_user_id", "is", null);
  for (const a of admins ?? []) {
    await pushLine(db, a.line_user_id!, [adminCard(
      kind === "tax" ? "ลูกค้าถามเรื่องภาษี 💬" : "ลูกค้าขอคุยกับเจ้าหน้าที่ 💬",
      [who, text === "ปรึกษาเจ้าหน้าที่" ? "(กดเมนูปรึกษาเจ้าหน้าที่)" : `"${mask(text).slice(0, 200)}"`,
       `กด "ฉันจะตอบเอง" แล้วตอบในแชท LINE OA — บอทจะพักกับลูกค้าคนนี้ ${PAUSE_HOURS} ชม.`],
      sr?.id ?? "")], { client_id: client?.id ?? null, recipient: "admin", kind: "support" });
  }
}

function adminCard(title: string, lines: string[], reqId: string) {
  const gold = "#a9822a";
  return {
    type: "flex", altText: title,
    contents: {
      type: "bubble",
      header: { type: "box", layout: "vertical", backgroundColor: gold, paddingAll: "16px",
        contents: [{ type: "text", text: title, color: "#ffffff", weight: "bold", size: "md", wrap: true }] },
      body: { type: "box", layout: "vertical", spacing: "sm", paddingAll: "16px",
        contents: lines.map((t) => ({ type: "text", text: t, size: "sm", color: "#333333", wrap: true })) },
      footer: { type: "box", layout: "vertical", spacing: "sm", paddingAll: "12px", contents: [
        ...(reqId ? [{ type: "button", style: "primary", color: "#26324a", height: "sm",
          action: { type: "postback", label: `ฉันจะตอบเอง (พักบอท ${PAUSE_HOURS} ชม.)`, data: `takeover:${reqId}`, displayText: "ฉันจะตอบเอง" } }] : []),
        { type: "button", style: "secondary", height: "sm", action: { type: "uri", label: "เปิดหลังบ้าน", uri: ADMIN_URL } },
      ] },
    },
  };
}

// admin กดปุ่มในการ์ดแจ้งเตือน: takeover = พักบอท, release = เปิดบอทคืน
// deno-lint-ignore no-explicit-any
async function adminPostback(db: SupabaseClient, ev: any) {
  const [act, id] = String(ev.postback?.data ?? "").split(":");
  if (!["takeover", "release"].includes(act) || !id) return;
  const { data: r } = await db.from("support_requests").select("id, line_user_id, client_id, clients(first_name, last_name)").eq("id", id).maybeSingle();
  if (!r) return reply(ev.replyToken, "ไม่พบเรื่องนี้แล้วครับ");
  // deno-lint-ignore no-explicit-any
  const c = r.clients as any;
  const who = c ? `คุณ${c.first_name} ${c.last_name}` : "ลูกค้า";
  const now = new Date();
  if (act === "takeover") {
    const until = new Date(now.getTime() + PAUSE_HOURS * 3600000);
    await db.from("chat_threads").upsert({ line_user_id: r.line_user_id, client_id: r.client_id, bot_paused_until: until.toISOString(), updated_at: now.toISOString() });
    const hhmm = until.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
    return replyMsg(ev.replyToken, {
      type: "text", text: `✅ บอทพักกับ${who}ถึง ${hhmm} น.\nตอบลูกค้าในแชท LINE OA ได้เลยครับ`,
      quickReply: { items: [{ type: "action", action: { type: "postback", label: "ตอบเสร็จ เปิดบอทคืน", data: `release:${id}`, displayText: "ตอบเสร็จแล้ว" } }] },
    });
  }
  await db.from("chat_threads").update({ bot_paused_until: null, updated_at: now.toISOString() }).eq("line_user_id", r.line_user_id);
  await db.from("support_requests").update({ status: "done", done_at: now.toISOString() }).eq("line_user_id", r.line_user_id).eq("status", "new");
  return reply(ev.replyToken, `🤖 บอทกลับมาตอบ${who}แล้วครับ`);
}

async function replyMsg(token: string, msg: unknown) {
  const r = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ replyToken: token, messages: [msg] }),
  });
  if (!r.ok) console.error("reply", r.status, (await r.text()).slice(0, 200));
}

type ClientRow = { id: string; client_code: string | null; first_name: string; last_name: string; status: Status };
type ThreadRow = { line_user_id: string; bot_paused_until: string | null; last_admin_ping: string | null };

// deno-lint-ignore no-explicit-any
async function handle(db: SupabaseClient, ev: any) {
  if (ev.source?.type !== "user" || !ev.replyToken || ev.mode === "standby") return;
  const uid: string = ev.source.userId;
  if (ev.type === "postback") {
    const { data: a } = await db.from("admins").select("user_id").eq("line_user_id", uid).limit(1);
    if (a?.length) await adminPostback(db, ev);
    return;
  }
  if (ev.type !== "message") return;                       // follow ใช้ข้อความต้อนรับของ OA Manager
  const [{ data: client }, { data: thread }, { data: adm }] = await Promise.all([
    db.from("clients").select("id, client_code, first_name, last_name, status").eq("line_user_id", uid).maybeSingle(),
    db.from("chat_threads").select("line_user_id, bot_paused_until, last_admin_ping").eq("line_user_id", uid).maybeSingle(),
    db.from("admins").select("user_id").eq("line_user_id", uid).limit(1),
  ]);
  const s: Status = (client?.status as Status) ?? "none";
  const isAdmin = !!adm?.length;                           // admin ทดสอบเอง: บอทไม่พัก
  const paused = !isAdmin && thread?.bot_paused_until && new Date(thread.bot_paused_until) > new Date();
  const m = ev.message;

  if (m.type !== "text") {
    if (paused || m.type === "sticker") return;
    if (m.type === "image" || m.type === "file") {
      await startLoading(uid); await sleep(MIN_THINK_MS);
      return reply(ev.replyToken, s === "active"
        ? "ถ้าเป็นเอกสารสำหรับยื่นภาษี แนะนำส่งผ่านเมนู \"นำส่งเอกสาร\" นะครับ เอกสารจะถูกเก็บเข้าระบบอย่างปลอดภัย และ AI ช่วยอ่านตัวเลขให้ทันที"
        : "ได้รับไฟล์แล้วครับ ถ้าเป็นเอกสารภาษี กรุณาลงทะเบียนและส่งผ่านเมนู \"นำส่งเอกสาร\" เพื่อความปลอดภัยของข้อมูลครับ",
        s === "active" ? ["upload", "staff"] : ["reg", "staff"]);
    }
    return;
  }

  const text = String(m.text ?? "").trim();
  if (!text) return;
  if (RE_RESUME.test(text)) {
    if (thread) await db.from("chat_threads").update({ bot_paused_until: null, updated_at: new Date().toISOString() }).eq("line_user_id", uid);
    return reply(ev.replyToken, "สวัสดีครับ ผู้ช่วย Tax Assistance พร้อมช่วยเรื่องการใช้งานแอปครับ เลือกเมนูหรือพิมพ์คำถามได้เลย", s === "none" ? ["reg", "staff"] : ["health", "upload", "docs", "staff"]);
  }
  if (paused) return;                                      // เจ้าหน้าที่กำลังดูแล — บอทเงียบ
  const t0 = Date.now();
  await startLoading(uid);
  const think = async () => { const w = MIN_THINK_MS - (Date.now() - t0); if (w > 0) await sleep(w); };
  if (RE_STAFF.test(text) && text.length <= 40) { await think(); return handoff(db, ev, uid, client, thread, "staff", text); }

  const r = (await askAI(mask(text), s)) ?? byRules(text, s);
  await think();
  if (r.intent === "tax") return handoff(db, ev, uid, client, thread, "tax", text);
  if (r.intent === "staff") return handoff(db, ev, uid, client, thread, "staff", text);

  const base: QRKey[] = s === "none" ? ["reg"] : ["health", "upload"];
  if (r.intent === "greeting") {
    return reply(ev.replyToken, r.reply || "สวัสดีครับ 😊 ผู้ช่วย Tax Assistance ช่วยเรื่องการใช้งานแอปได้ครับ ส่วนคำถามภาษี เจ้าหน้าที่จะตอบให้ครับ", r.buttons.length ? r.buttons : [...base, "staff"]);
  }
  if (r.intent === "taxinfo" && r.reply) {
    const btn: QRKey[] = s === "active" ? ["health", "staff"] : s === "none" ? ["reg", "staff"] : ["staff"];
    return reply(ev.replyToken, r.reply, btn);
  }
  if (r.intent === "app" && r.reply) {
    const btn = r.buttons.includes("staff") ? r.buttons : [...r.buttons, "staff" as QRKey];
    return reply(ev.replyToken, r.reply, btn);
  }
  return reply(ev.replyToken,
    "ขออภัยครับ ยังไม่เข้าใจคำถาม 🙏\nบอทช่วยเรื่องการใช้งานแอปได้ เช่น \"ส่งเอกสารยังไง\" \"เปิดหน้าไม่ได้\" \"สถานะเอกสาร\"\nถ้าเป็นเรื่องภาษีหรืออยากคุยกับคน กด \"ปรึกษาเจ้าหน้าที่\" ได้เลยครับ",
    s === "none" ? ["reg", "staff"] : ["upload", "docs", "staff"]);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const body = await req.text();
  if (!SECRET) { console.error("LINE_CHANNEL_SECRET not set"); return new Response("not configured", { status: 500 }); }
  if (!(await verify(body, req.headers.get("x-line-signature")))) return new Response("bad signature", { status: 401 });
  let events: unknown[] = [];
  try { events = JSON.parse(body).events ?? []; } catch { return new Response("bad json", { status: 400 }); }
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  await Promise.all(events.map((ev) => handle(db, ev).catch((e) => console.error("event", String(e).slice(0, 300)))));
  return new Response("ok");
});
