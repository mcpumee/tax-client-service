export const DOC_LABEL: Record<string, string> = {
  "50tawi": "50 ทวิ (หนังสือรับรองหัก ณ ที่จ่าย)",
  insurance_cert: "หนังสือรับรองเบี้ยประกัน",
  fund_cert: "กองทุน RMF / SSF / ThaiESG",
  mortgage_interest: "ดอกเบี้ยเงินกู้บ้าน",
  donation: "ใบอนุโมทนา / เงินบริจาค",
  rental_contract: "สัญญาเช่า / รายได้ค่าเช่า",
  platform_report: "รายงานยอดขายออนไลน์",
  statement: "Statement ธนาคาร",
  salary_slip: "สลิปเงินเดือน",
  receipt: "ใบเสร็จค่าใช้จ่าย",
  id_card: "บัตรประชาชน",
  house_reg: "ทะเบียนบ้าน",
  other: "เอกสารอื่น ๆ",
};
export const DOC_CATEGORY: Record<string, string> = {
  "50tawi": "income", insurance_cert: "deduction", fund_cert: "deduction", mortgage_interest: "deduction",
  donation: "deduction", rental_contract: "income", platform_report: "income", statement: "income",
  salary_slip: "income", receipt: "expense", id_card: "identity", house_reg: "identity", other: "other",
};
export const thYear = (y: number | null) => (y ? String(y + 543) : "–");
