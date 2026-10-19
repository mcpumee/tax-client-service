/* =====================================================================
 * Tax Assistance (TA) — เครื่องคำนวณภาษีเงินได้บุคคลธรรมดา (ประมาณการ)
 * ใช้ร่วมกันทั้งหน้าลูกค้า (LIFF) และหลังบ้าน
 *
 * ขอบเขต: เงินได้ ม.40(1)–(2) (เงินเดือน โบนัส ค่าจ้าง ค่านายหน้า)
 * อัปเดตกฎ: แก้ที่ RULES[ปีภาษี ค.ศ.] แล้ว deploy
 * แหล่งอ้างอิง (ตรวจล่าสุด ต.ค. 2569): ttb, Krungsri, Allianz Ayudhya — ต้องเทียบประกาศกรมสรรพากร
 * ===================================================================== */
(function (root) {
  "use strict";

  const RULES = {
    2026: { // ปีภาษี 2569
      label: "ปีภาษี 2569",
      brackets: [ // [เงินได้สุทธิถึง, อัตรา]
        [150000, 0], [300000, 0.05], [500000, 0.10], [750000, 0.15],
        [1000000, 0.20], [2000000, 0.25], [5000000, 0.30], [Infinity, 0.35],
      ],
      expense: { pct: 0.5, cap: 100000 },          // ค่าใช้จ่าย 40(1)+(2)
      personal: 60000, spouse: 60000,
      child: 30000, child2plus2018: 60000,         // บุตรคนที่ 2 ขึ้นไปที่เกิดตั้งแต่ปี 2561
      parent: 30000, parentMax: 4,
      maternity: 60000,
      sso: { cap: 10500, rate: 0.05, wageCap: 17500 },
      // รายการที่ลูกค้ากรอกจำนวนเงิน
      items: [
        { k: "life",        t: "ประกันชีวิต / สะสมทรัพย์",          cap: 100000, sell: true,  group: "lifehealth", hint: "กรมธรรม์ 10 ปีขึ้นไป" },
        { k: "health",      t: "ประกันสุขภาพตัวเอง",                 cap: 25000,  sell: true,  group: "lifehealth" },
        { k: "parentHealth",t: "ประกันสุขภาพบิดามารดา",              cap: 15000,  sell: true,  hint: "พ่อแม่มีเงินได้ไม่เกิน 30,000/ปี" },
        { k: "spouseLife",  t: "ประกันชีวิตคู่สมรส (ไม่มีเงินได้)", cap: 10000,  sell: true,  needSpouse: true },
        { k: "pension",     t: "ประกันชีวิตแบบบำนาญ",                cap: 200000, pct: 0.15, sell: true, group: "retire" },
        { k: "pvd",         t: "กองทุนสำรองเลี้ยงชีพ (PVD) / กบข.",  cap: 500000, pct: 0.15, group: "retire" },
        { k: "rmf",         t: "กองทุน RMF",                         cap: 500000, pct: 0.30, group: "retire" },
        { k: "gor", niche: true,         t: "กอช.",                                cap: 30000,  group: "retire" },
        { k: "esgx",        t: "กองทุน Thai ESGX (เงินลงทุนใหม่)",  cap: 300000, pct: 0.30 },
        { k: "homeLoan", niche: true,    t: "ดอกเบี้ยเงินกู้ซื้อบ้าน",             cap: 100000 },
        { k: "solar", niche: true,       t: "Solar Rooftop / อุปกรณ์ประหยัดพลังงาน", cap: 200000, hint: "มาตรการปี 2569–2571" },
        { k: "craft", niche: true,       t: "ผลงานศิลปะหัตถศิลป์",                cap: 100000, hint: "มาตรการปี 2568–2570" },
        { k: "socialEnt", niche: true,   t: "ลงทุนวิสาหกิจเพื่อสังคม",            cap: 100000 },
      ],
      groups: { lifehealth: 100000, retire: 500000 },
      donation: { pct: 0.10 }, // บริจาคทั่วไป ไม่เกิน 10% ของเงินได้หลังหักค่าใช้จ่ายและลดหย่อน
      donation2x: { mult: 2, pct: 0.10 },
      notes: [
        "Easy E-Receipt ปี 2569 ยังไม่ประกาศ (รอมติ ครม.)",
        "ประกันบำนาญใช้สิทธิส่วนที่เหลือของประกันชีวิต 100,000 ได้ — ระบบนี้คิดแบบอนุรักษ์นิยม",
      ],
    },
  };
  RULES[2025] = Object.assign({}, RULES[2026], { label: "ปีภาษี 2568",
    sso: { cap: 9000, rate: 0.05, wageCap: 15000 },
    items: RULES[2026].items.filter((i) => i.k !== "solar") });

  const r0 = (n) => Math.max(0, Math.round(+n || 0));

  function taxOn(net, br) {
    let tax = 0, prev = 0;
    for (const [upto, rate] of br) {
      if (net <= prev) break;
      tax += (Math.min(net, upto) - prev) * rate;
      prev = upto;
    }
    return Math.round(tax);
  }
  function marginal(net, br) {
    let prev = 0;
    for (const [upto, rate] of br) { if (net <= upto) return { rate, from: prev, to: upto }; prev = upto; }
    return { rate: br[br.length - 1][1], from: prev, to: Infinity };
  }

  /** ประกันสังคมโดยประมาณจากเงินเดือน */
  function ssoFromSalary(monthly, year = 2026) {
    const s = (RULES[year] || RULES[2026]).sso;
    return Math.min(s.cap, Math.round(Math.min(+monthly || 0, s.wageCap) * s.rate) * 12);
  }

  /**
   * คำนวณภาษี
   * input = { year, income, withheld, spouseNoIncome, children, children2plus2018, parents, maternity,
   *           sso, items: { life, health, ... }, donation, donation2x }
   */
  function calculate(input) {
    const R = RULES[input.year] || RULES[2026];
    const income = r0(input.income);
    const expense = Math.min(income * R.expense.pct, R.expense.cap);
    const lines = [];
    const add = (k, t, amt, cap) => { if (amt > 0) lines.push({ k, t, amt: Math.round(amt), cap }); return amt; };

    let ded = 0;
    ded += add("personal", "ส่วนตัว", R.personal);
    if (input.spouseNoIncome) ded += add("spouse", "คู่สมรสไม่มีเงินได้", R.spouse);
    const ch = r0(input.children), ch2 = Math.min(r0(input.children2plus2018), Math.max(0, ch - 1));
    ded += add("children", `บุตร ${ch} คน`, (ch - ch2) * R.child + ch2 * R.child2plus2018);
    ded += add("parents", `อุปการะบิดามารดา ${Math.min(r0(input.parents), R.parentMax)} คน`, Math.min(r0(input.parents), R.parentMax) * R.parent);
    ded += add("maternity", "ฝากครรภ์และคลอดบุตร", Math.min(r0(input.maternity), R.maternity), R.maternity);
    ded += add("sso", "ประกันสังคม", Math.min(r0(input.sso), R.sso.cap), R.sso.cap);

    const used = {}, room = {};
    const groupUsed = { lifehealth: 0, retire: 0 };
    for (const it of R.items) {
      if (it.needSpouse && !input.spouseNoIncome) { used[it.k] = 0; room[it.k] = 0; continue; }
      const itemCap = Math.min(it.cap, it.pct ? income * it.pct : Infinity);
      const gLeft = it.group ? R.groups[it.group] - groupUsed[it.group] : Infinity;
      const cap = Math.max(0, Math.min(itemCap, gLeft));
      const amt = Math.min(r0((input.items || {})[it.k]), cap);
      used[it.k] = amt;
      if (it.group) groupUsed[it.group] += amt;
      ded += add(it.k, it.t, amt, Math.round(itemCap));
    }
    // ห้องที่เหลือ (คิดหลังใช้สิทธิทั้งหมดแล้ว)
    for (const it of R.items) {
      if (it.needSpouse && !input.spouseNoIncome) continue;
      const itemCap = Math.min(it.cap, it.pct ? income * it.pct : Infinity);
      const gLeft = it.group ? R.groups[it.group] - groupUsed[it.group] : Infinity;
      room[it.k] = Math.max(0, Math.round(Math.min(itemCap - used[it.k], gLeft)));
    }

    const beforeDon = Math.max(0, income - expense - ded);
    const don2Cap = beforeDon * R.donation2x.pct;
    const don2 = Math.min(r0(input.donation2x) * R.donation2x.mult, don2Cap);
    const donCap = Math.max(0, (beforeDon - don2) * R.donation.pct);
    const don = Math.min(r0(input.donation), donCap);
    if (don2) lines.push({ k: "donation2x", t: "บริจาคการศึกษา/กีฬา/รพ.รัฐ (2 เท่า)", amt: Math.round(don2) });
    if (don) lines.push({ k: "donation", t: "เงินบริจาคทั่วไป", amt: Math.round(don) });

    const net = Math.max(0, Math.round(beforeDon - don2 - don));
    const tax = taxOn(net, R.brackets);
    const withheld = r0(input.withheld);
    const m = marginal(net, R.brackets);

    // ---------- คำแนะนำ ----------
    const toZero = Math.max(0, net - R.brackets[0][0]);
    const toLower = m.rate > 0 ? Math.max(0, net - m.from) : 0;
    const suggestions = R.items
      .filter((it) => room[it.k] > 0 && !(it.needSpouse && !input.spouseNoIncome))
      .map((it) => {
        const use = Math.min(room[it.k], toZero);
        const save = tax - taxOn(Math.max(0, net - use), R.brackets);
        return { k: it.k, t: it.t, room: room[it.k], useful: use, save, sell: !!it.sell, niche: !!it.niche, hint: it.hint || null };
      })
      .filter((s) => s.save > 0)
      .sort((a, b) => (b.save - a.save) || (b.sell - a.sell));

    return {
      year: input.year, label: R.label, income, expense: Math.round(expense), deductions: Math.round(ded + don + don2),
      lines, net, tax, withheld, diff: withheld - tax, // บวก = ได้คืน, ลบ = ต้องจ่ายเพิ่ม
      rate: m.rate, bracket: m, toZero, toLower, room, suggestions, notes: R.notes,
      needMore: tax > 0,
    };
  }

  /* -------------------------------------------------------------------
   * รวมข้อมูล: ตัวเลขจากเอกสารที่เจ้าหน้าที่ยืนยันแล้ว (doc) มาก่อน
   * ไม่มีเอกสาร → ใช้ตัวเลขที่ลูกค้ากรอกเอง (self)
   *
   * extracted_data ต่อประเภทเอกสาร:
   *   50tawi            { income, withheld, sso?, pvd? }
   *   insurance_cert    { items: [{ kind: life|health|pension|parentHealth|spouseLife, amount }] }  (รุ่นเก่า: { kind, amount })
   *   fund_cert         { kind: rmf|esgx|pvd|gor, amount }
   *   mortgage_interest { amount }            → homeLoan
   *   donation          { amount, double? }   → donation / donation2x
   * ------------------------------------------------------------------- */
  const n0 = (x) => Math.max(0, +x || 0);
  function buildInput(plan, docs, year) {
    plan = plan || {}; docs = docs || [];
    const src = { income: null, withheld: null, sso: null, items: {} };
    const d = { income: 0, withheld: 0, sso: 0, items: {}, donation: 0, donation2x: 0, n50: 0 };
    for (const doc of docs) {
      const x = doc.extracted_data || {};
      if (doc.doc_type === "50tawi") { d.n50++; d.income += n0(x.income); d.withheld += n0(x.withheld); d.sso += n0(x.sso);
        if (n0(x.pvd)) d.items.pvd = (d.items.pvd || 0) + n0(x.pvd); }
      else if (doc.doc_type === "insurance_cert" || doc.doc_type === "fund_cert") {
        if (Array.isArray(x.items)) for (const it of x.items) { if (it && it.kind) d.items[it.kind] = (d.items[it.kind] || 0) + n0(it.amount); }
        else if (x.kind) d.items[x.kind] = (d.items[x.kind] || 0) + n0(x.amount);
      }
      else if (doc.doc_type === "mortgage_interest") d.items.homeLoan = (d.items.homeLoan || 0) + n0(x.amount);
      else if (doc.doc_type === "donation") { if (x.double) d.donation2x += n0(x.amount); else d.donation += n0(x.amount); }
    }
    const selfIncome = n0(plan.salary) * (n0(plan.months) || 12) + n0(plan.bonus);
    const selfWht = n0(plan.wht) * (n0(plan.months) || 12) + n0(plan.whtx);
    const pick = (docV, selfV, key) => { if (docV > 0) { src[key] = "doc"; return docV; } if (selfV > 0) { src[key] = "self"; return selfV; } return 0; };
    const items = {};
    const selfItems = plan.items || {};
    const keys = new Set([...Object.keys(selfItems), ...Object.keys(d.items)]);
    let claimed = 0, claimedNoDoc = 0;
    for (const k of keys) {
      if (d.items[k] > 0) { items[k] = d.items[k]; src.items[k] = "doc"; claimed++; }
      else if (n0(selfItems[k]) > 0) { items[k] = n0(selfItems[k]); src.items[k] = "self"; claimed++; claimedNoDoc++; }
    }
    return {
      input: {
        year, income: pick(d.income, selfIncome, "income"), withheld: pick(d.withheld, selfWht, "withheld"),
        spouseNoIncome: !!plan.spouseNoIncome, children: n0(plan.children), children2plus2018: n0(plan.children2plus2018),
        parents: n0(plan.parents), maternity: n0(plan.maternity), sso: pick(d.sso, n0(plan.sso), "sso"),
        items, donation: d.donation || n0(plan.donation), donation2x: d.donation2x || n0(plan.donation2x),
      },
      src, has50: d.n50 > 0, hasPlan: selfIncome > 0, claimed, claimedNoDoc,
    };
  }

  /** คะแนนสุขภาพภาษี 0–100 */
  function healthScore(built) {
    const { input } = built;
    const R = RULES[input.year] || RULES[2026];
    const r = calculate(input);
    // ภาษีถ้าไม่มีลดหย่อนเลือกได้ (มีแค่ส่วนตัว/ครอบครัว/ประกันสังคม)
    const base = calculate({ ...input, items: {}, donation: 0, donation2x: 0 });
    // เกณฑ์ "วางแผนดี": ใช้สิทธิประกันชีวิต/สุขภาพ/บำนาญเต็ม (+พ่อแม่/คู่สมรสถ้ามี)
    // ไม่นับ RMF/ESGX/PVD เต็มเพดาน เพราะไม่ใช่ทุกคนจะลงทุนได้
    if (!input.income) return { score: null, level: "nodata", parts: {}, r, minTax: r.tax, overpay: 0 };
    const bench = ["life", "health", "pension"];
    if (input.parents > 0) bench.push("parentHealth");
    if (input.spouseNoIncome) bench.push("spouseLife");
    const maxed = { ...input.items };
    for (const k of bench) maxed[k] = (maxed[k] || 0) + (r.room[k] || 0);
    const best = calculate({ ...input, items: maxed });
    const span = base.tax - best.tax;
    const util = r.tax === 0 ? 1 : span > 0 ? Math.min(1, Math.max(0, (base.tax - r.tax) / span)) : 1;
    const A = 50 * util;
    // จ่ายเพิ่มก้อนใหญ่ = หักเต็ม · ได้คืนก้อนใหญ่ = หักครึ่งเดียว (เงินไม่หาย แค่ได้คืนช้า)
    const gap = Math.min(1, Math.abs(r.diff) / Math.max(r.tax, 10000)) * (r.diff > 0 ? 0.5 : 1);
    const B = (r.tax === 0 && r.withheld === 0) ? 20 : 20 * (1 - gap);
    const C = 10 * (built.has50 ? 1 : 0) + 10 * (built.claimed ? (built.claimed - built.claimedNoDoc) / built.claimed : (built.has50 ? 1 : 0));
    const D = (built.hasPlan || built.has50) ? 10 : 0;
    const score = Math.round(A + B + C + D);
    return {
      score, level: score >= 80 ? "good" : score >= 60 ? "fair" : "poor",
      parts: { deduct: Math.round(A), balance: Math.round(B), docs: Math.round(C), data: D },
      r, minTax: best.tax, overpay: Math.max(0, r.tax - best.tax),
    };
  }

  /* -------------------------------------------------------------------
   * แผนลดหย่อนเฉพาะบุคคล — วิเคราะห์จากข้อมูลจริง แบบตรงไปตรงมา
   * profile (จากคำถามสั้น ๆ): age, parentsAsked, hasHealthCover, hasPVDScheme, hasHomeLoan
   * ค่า null = ยังไม่รู้ → สร้างคำถามแทนการเดา
   * ผลลัพธ์: { intro, free[], adjust[], spend[], skip[], questions[] }
   * ------------------------------------------------------------------- */
  function advise(built, h, profile) {
    profile = profile || {};
    const { input } = built, r = h.r;
    const R = RULES[input.year] || RULES[2026];
    const age = profile.age || null;
    const rate = r.rate;
    const out = { intro: "", free: [], adjust: [], spend: [], more: [], skip: [], questions: [] };
    const saveOf = (amt) => r.tax - taxOn(Math.max(0, r.net - amt), R.brackets);
    const pct = Math.round(rate * 100);

    // ---------- บทนำแบบตรงไปตรงมา ----------
    if (!r.income) return out;
    if (r.tax === 0) out.intro = "ตอนนี้ไม่ต้องเสียภาษี — ไม่จำเป็นต้องซื้อประกันหรือกองทุนเพื่อลดภาษีเลย ถ้าจะซื้อ ให้ซื้อเพราะต้องการความคุ้มครองหรือการออม";
    else if (rate <= 0.05) out.intro = `อยู่ขั้นภาษี ${pct}% — ลดหย่อน 10,000 บาท ประหยัดภาษีแค่ ${baht(10000 * rate)} บาท ควรซื้อประกัน/กองทุนเพราะต้องการความคุ้มครองหรือออมเงินเป็นหลัก ไม่ใช่เพื่อภาษีอย่างเดียว`;
    else out.intro = `อยู่ขั้นภาษี ${pct}% — ลดหย่อนทุก 10,000 บาท ประหยัดภาษี ${baht(10000 * rate)} บาท เริ่มจากสิทธิที่ไม่ต้องเสียเงินก่อน แล้วค่อยพิจารณาสิ่งที่ต้องจ่าย`;

    // ---------- 1) สิทธิที่ไม่ต้องเสียเงินเพิ่ม ----------
    if (input.parents === 0 && !profile.parentsAsked) {
      out.questions.push({ k: "parents", q: "คุณดูแลพ่อหรือแม่ที่อายุ 60 ปีขึ้นไป และมีรายได้ไม่เกิน 30,000 บาท/ปี ไหม?", opts: [["0", "ไม่มี"], ["1", "1 คน"], ["2", "2 คน"]] });
    }
    if (!input.sso && r.income >= 120000) {
      out.free.push({ k: "sso", t: "ตรวจสอบเงินสมทบประกันสังคม", save: saveOf(Math.min(R.sso.cap, Math.round(r.income / 12 * 0.05) * 12)),
        why: "พนักงานบริษัทถูกหักประกันสังคมทุกเดือน ลดหย่อนได้ตามจริงสูงสุด " + baht(R.sso.cap) + " บาท แต่ยังไม่มีตัวเลขในระบบ",
        how: "ดูยอดในสลิปเงินเดือนหรือ 50 ทวิ แล้วกรอกเพิ่ม" , go: "plan" });
    }
    if (profile.hasHealthCover === true && !(built.input.items.health > 0)) {
      out.free.push({ k: "health", t: "ใช้สิทธิประกันสุขภาพที่มีอยู่แล้ว", save: saveOf(Math.min(25000, r.room.health || 25000)),
        why: "คุณบอกว่ามีประกันสุขภาพอยู่แล้ว แต่ยังไม่ได้นำมาลดหย่อน (สูงสุด 25,000 บาท)",
        how: "ขอหนังสือรับรองการชำระเบี้ยจากบริษัทประกัน แล้วส่งในเมนูนำส่งเอกสาร", go: "upload" });
    }
    if (profile.hasHomeLoan === true && !(built.input.items.homeLoan > 0)) {
      out.free.push({ k: "homeLoan", t: "ใช้สิทธิดอกเบี้ยเงินกู้ซื้อบ้าน", save: saveOf(Math.min(100000, Math.round(r.income * 0.1))),
        why: "คุณผ่อนบ้านอยู่ ดอกเบี้ยที่จ่ายทั้งปีลดหย่อนได้สูงสุด 100,000 บาท",
        how: "ขอหนังสือรับรองดอกเบี้ยจากธนาคาร (มักส่งให้ช่วง ม.ค.) แล้วส่งในเมนูนำส่งเอกสาร", go: "upload" });
    }
    if (built.claimedNoDoc > 0) {
      out.free.push({ k: "docs", t: `ส่งหลักฐานลดหย่อน ${built.claimedNoDoc} รายการ`, save: 0,
        why: "ตัวเลขลดหย่อนบางรายการมาจากที่กรอกเอง ถ้าไม่มีหลักฐาน อาจถูกเรียกเก็บภาษีย้อนหลังเมื่อสรรพากรตรวจ",
        how: "ส่งหนังสือรับรองของแต่ละรายการในเมนูนำส่งเอกสาร", go: "upload" });
    }

    // ---------- 2) ปรับการหักภาษีให้ตรง ----------
    if (r.diff > Math.max(3000, r.tax * 0.25) && r.tax >= 0) {
      out.adjust.push({ k: "ly01", t: "ถูกหักภาษีเกินทุกเดือน",
        why: `คาดว่าจะได้คืน ${baht(r.diff)} บาท แปลว่าบริษัทหักภาษีไว้มากเกินไป เงินก้อนนี้จะได้คืนหลังยื่นภาษีอีกหลายเดือน`,
        how: "ยื่นแบบ ล.ย.01 แจ้งค่าลดหย่อนกับฝ่ายบุคคล บริษัทจะหักภาษีรายเดือนให้ตรงขึ้น เงินเดือนสุทธิมากขึ้นทันที" });
    } else if (r.diff < -3000) {
      out.adjust.push({ k: "short", t: `ต้องเตรียมเงินจ่ายเพิ่ม ${baht(-r.diff)} บาท ตอนยื่นภาษี`,
        why: "ภาษีที่บริษัทหักไว้น้อยกว่าภาษีจริง",
        how: "ใช้แผนลดหย่อนข้างล่างเพื่อลดยอดนี้ หรือแจ้งฝ่ายบุคคลให้หักเพิ่มรายเดือน จะได้ไม่ต้องจ่ายก้อนใหญ่ทีเดียว" });
    }

    // ---------- 3) สิ่งที่ต้องใช้เงิน (คัดตามความเหมาะสม) ----------
    if (r.tax > 0) {
      // จำนวนที่แนะนำ: พอให้ลงขั้นภาษีถัดไป (ถ้าอยู่ขั้น ≥10%) ไม่งั้นพอให้ภาษีเป็น 0
      const target = rate >= 0.10 && r.toLower > 0 ? r.toLower : r.toZero;
      const dependents = input.children > 0 || input.spouseNoIncome || input.parents > 0;
      const cands = [];
      const add = (k, fit, why, cond) => {
        const room = r.room[k] || 0; if (room <= 0) return;
        const amt = Math.max(1000, Math.min(room, Math.ceil(target / 1000) * 1000));
        const save = saveOf(amt);
        if (save <= 0) return;
        cands.push({ k, t: (R.items.find((i) => i.k === k) || {}).t || k, fit, amt, save, net: amt - save, room, why, cond });
      };
      if (profile.hasPVDScheme === true) add("pvd", 3, "บริษัทของคุณมีกองทุนสำรองเลี้ยงชีพ — เพิ่มอัตราสะสมได้ นายจ้างมักสมทบให้ด้วย จึงคุ้มที่สุด", "แจ้งเพิ่มอัตราสะสมกับฝ่ายบุคคล ถอนก่อนเกษียณ/ออกจากงานอาจเสียภาษี");
      if (profile.hasHealthCover !== true) add("health", 3, "ยังไม่มีประกันสุขภาพ — ได้ความคุ้มครองค่ารักษาพยาบาลจริง และลดภาษีไปพร้อมกัน", "ลดหย่อนได้สูงสุด 25,000 (รวมกับประกันชีวิตไม่เกิน 100,000)");
      if (input.parents > 0) add("parentHealth", 2, "คุณดูแลพ่อแม่ — ประกันสุขภาพพ่อแม่ช่วยรับภาระค่ารักษาและลดหย่อนได้", "พ่อแม่ต้องมีรายได้ไม่เกิน 30,000 บาท/ปี ลดหย่อนได้รวมไม่เกิน 15,000");
      if (age && age >= 30 && age < 55) add("pension", age >= 40 ? 3 : 2, `อายุ ${age} ปี ยังมีเวลาออมเพื่อเกษียณ ${55 - age}+ ปี — ได้ทั้งเงินบำนาญและลดภาษี`, "จ่ายเบี้ยถึงอายุ 55–60 ปี รับเงินบำนาญหลังเกษียณ เลิกกลางทางอาจได้เงินคืนน้อยกว่าที่จ่าย");
      else if (!age) add("pension", 2, "เหมาะกับคนที่ต้องการออมเพื่อเกษียณระยะยาวและลดภาษี", "จ่ายเบี้ยถึงอายุ 55–60 ปี เลิกกลางทางอาจได้เงินคืนน้อยกว่าที่จ่าย");
      if (dependents) add("life", 2, "มีคนที่พึ่งพาคุณ (ครอบครัว/บุตร/พ่อแม่) — ประกันชีวิตช่วยคุ้มครองครอบครัวถ้าเกิดเหตุไม่คาดฝัน", "กรมธรรม์ต้องมีอายุ 10 ปีขึ้นไป ยกเลิกก่อนกำหนดต้องคืนภาษีที่เคยลดหย่อน");
      else add("life", 1, "ยังไม่มีผู้พึ่งพิง — ประกันชีวิตเพื่อความคุ้มครองอาจยังไม่จำเป็น ถ้าต้องการออมเงินให้เลือกแบบสะสมทรัพย์", "กรมธรรม์ 10 ปีขึ้นไป ยกเลิกก่อนกำหนดต้องคืนภาษีที่เคยลดหย่อน");
      if (age && age >= 40) add("rmf", 2, `อายุ ${age} ปี ใกล้ช่วงเกษียณ — RMF ช่วยออมและลดภาษี`, "ถือ 5 ปีขึ้นไปและจนอายุ 55 ปี มูลค่าขึ้นลงตามตลาด ไม่การันตีเงินต้น");
      add("esgx", 1, "เหมาะกับคนที่รับความเสี่ยงหุ้นได้และมีเงินเย็น", "ต้องถือ 5 ปีตามเงื่อนไขกองทุน มูลค่าขึ้นลงตามตลาดหุ้น ไม่การันตีเงินต้น");
      // ลำดับ: ความคุ้มครองก่อน (สุขภาพ) → สิ่งที่นายจ้างช่วยจ่าย (PVD) → ดูแลพ่อแม่ → เกษียณ → ชีวิต → กองทุนเสี่ยง
      const PRI = ["health", "pvd", "parentHealth", "pension", "life", "rmf", "esgx"];
      cands.sort((a, b) => (b.fit - a.fit) || (PRI.indexOf(a.k) - PRI.indexOf(b.k)));
      // จัดสรรเป็นแผนเดียว: เติมรายการที่เหมาะที่สุดก่อน จนครบยอดเป้าหมาย (ไม่แนะนำให้ซื้อทุกอย่างพร้อมกัน)
      let remain = Math.ceil(target / 1000) * 1000, usedSoFar = 0, maxPlan = rate <= 0.05 ? 1 : 3;
      for (const c of cands) {
        if (c.fit >= 2 && remain > 0 && out.spend.length < maxPlan) {
          const amt = Math.min(c.room, remain);
          const save = taxOn(Math.max(0, r.net - usedSoFar), R.brackets) - taxOn(Math.max(0, r.net - usedSoFar - amt), R.brackets);
          usedSoFar += amt; remain -= amt;
          out.spend.push({ ...c, amt, save, net: amt - save });
        } else (c.fit >= 2 ? out.more : out.skip).push(c);
      }
      out.plan = out.spend.length ? { amt: usedSoFar, save: r.tax - taxOn(Math.max(0, r.net - usedSoFar), R.brackets),
        goal: rate >= 0.10 && r.toLower > 0 ? `ลงมาอยู่ขั้นภาษี ${pct - 5}%` : "ไม่ต้องเสียภาษี" } : null;
    }

    // ---------- คำถามเติมข้อมูล (ถามเฉพาะเมื่อมีภาษีต้องเสีย) ----------
    if (r.tax === 0) { out.questions = []; return out; }
    if (!age) out.questions.push({ k: "age", q: "อายุของคุณ (ใช้เลือกแผนเกษียณที่เหมาะ)", input: "number" });
    if (profile.hasHealthCover == null) out.questions.push({ k: "hasHealthCover", q: "ตอนนี้คุณมีประกันสุขภาพส่วนตัว (ไม่นับประกันกลุ่มของบริษัท) ไหม?", opts: [["1", "มี"], ["0", "ไม่มี"]] });
    if (profile.hasPVDScheme == null) out.questions.push({ k: "hasPVDScheme", q: "บริษัทของคุณมีกองทุนสำรองเลี้ยงชีพ (PVD) ไหม?", opts: [["1", "มี"], ["0", "ไม่มี / ไม่แน่ใจ"]] });
    if (profile.hasHomeLoan == null) out.questions.push({ k: "hasHomeLoan", q: "คุณกำลังผ่อนบ้านหรือคอนโดอยู่ไหม?", opts: [["1", "ผ่อนอยู่"], ["0", "ไม่ได้ผ่อน"]] });
    return out;
  }
  function baht(n) { return Math.round(n).toLocaleString("th-TH"); }

  const api = { RULES, calculate, taxOn, marginal, ssoFromSalary, buildInput, healthScore, advise };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.TaxCalc = api;
})(typeof window !== "undefined" ? window : globalThis);
