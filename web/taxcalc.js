/* =====================================================================
 * Mc Service — เครื่องคำนวณภาษีเงินได้บุคคลธรรมดา (ประมาณการ)
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

  const api = { RULES, calculate, taxOn, marginal, ssoFromSalary };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.TaxCalc = api;
})(typeof window !== "undefined" ? window : globalThis);
